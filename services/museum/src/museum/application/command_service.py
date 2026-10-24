from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from typing import Any
from uuid import uuid4

from museum.application.control_tickets import ControlTickets
from museum.domain.session.events import SessionEvent, SessionEventKind, TransitionResult
from museum.domain.session.models import SessionState
from museum.domain.session.transitions import (
    InvalidTransition,
    focus_entity,
    return_to_story,
)
from museum.domain.story.conditions import Condition, ConditionOp, InvalidStoryRule
from museum.domain.story.effects import Effect, EffectOp
from museum.domain.story.engine import InvalidStoryAction, advance_story, start_story
from museum.domain.story.models import (
    ExitAction,
    StoryAction,
    StoryDefinition,
    StoryExit,
    StoryNode,
)
from museum.ports.content_catalog import ContentCatalog, PublishedPack
from museum.ports.unit_of_work import UnitOfWork

OPAQUE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
NAMESPACED_ID = re.compile(r"^[a-z]{2}(?:\.[a-z0-9-]+){2,8}$")
COMMAND_ACTIONS = frozenset(
    {
        "open_artifact",
        "enter_story",
        "continue_story",
        "pause_story",
        "return_to_story",
        "focus_detail",
        "set_view",
        "choose_action",
    }
)


class InvalidCommand(ValueError):
    """A command envelope does not match the public protocol."""


class SessionNotFound(LookupError):
    """The command targets a session that does not exist."""


class PinnedContentUnavailable(LookupError):
    """A target is not present in any content version pinned by this session."""


class InvalidStoryContent(ValueError):
    """A pinned published story cannot be safely interpreted by the domain engine."""


@dataclass(frozen=True, slots=True)
class CommandReceipt:
    receipt_id: str
    request_id: str
    session_id: str
    status: str
    revision: int
    interaction_epoch: int
    action: str
    payload_digest: str
    view_revision: int
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema_version": "1",
            "receipt_id": self.receipt_id,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "status": self.status,
            "revision": self.revision,
            "view_revision": self.view_revision,
            "interaction_epoch": self.interaction_epoch,
            "action": self.action,
            "payload_digest": self.payload_digest,
        }
        if self.reason is not None:
            result["reason"] = self.reason
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> CommandReceipt:
        return cls(
            receipt_id=value["receipt_id"],
            request_id=value["request_id"],
            session_id=value["session_id"],
            status=value["status"],
            revision=value["revision"],
            view_revision=value.get("view_revision", 0),
            interaction_epoch=value["interaction_epoch"],
            action=value.get("action", ""),
            payload_digest=value.get("payload_digest", ""),
            reason=value.get("reason"),
        )


@dataclass(frozen=True, slots=True)
class _Command:
    request_id: str
    expected_revision: int
    interaction_epoch: int
    action: str
    target_id: str | None
    expected_view_revision: int | None
    control_ticket: str
    params: Mapping[str, Any]


class CommandService:
    """The only write path from user commands into session and story state."""

    def __init__(
        self,
        transaction: Callable[[], AbstractContextManager[UnitOfWork]],
        catalog: ContentCatalog,
        tickets: ControlTickets,
        *,
        receipt_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._transaction = transaction
        self._catalog = catalog
        self._tickets = tickets
        self._receipt_id_factory = receipt_id_factory or (lambda: uuid4().hex)

    def execute(self, session_id: str, actor_id: str, payload: Mapping[str, Any]) -> CommandReceipt:
        command = _parse_command(payload)
        digest = _payload_digest(payload)
        with self._transaction() as unit:
            original = unit.receipts.get(session_id, command.request_id, digest)
            if original is not None:
                # Authentication is provided by the caller before this service; an old
                # request may replay its receipt, but never regains write permission.
                return CommandReceipt.from_dict(original)

            state = unit.sessions.get(session_id)
            if state is None:
                raise SessionNotFound(f"会话不存在：{session_id}")
            self._tickets.validate(
                command.control_ticket,
                session_id=session_id,
                actor_id=actor_id,
                action=command.action,
            )

            reason = _stale_reason(state, command)
            if reason:
                receipt = self._rejected(command, session_id, digest, state, reason)
                unit.receipts.save(session_id, command.request_id, digest, receipt.to_dict())
                return receipt

            try:
                transition = self._apply(state, command)
            except (
                InvalidTransition,
                InvalidStoryAction,
                InvalidStoryContent,
                LookupError,
                ValueError,
            ) as error:
                receipt = self._rejected(command, session_id, digest, state, str(error))
                unit.receipts.save(session_id, command.request_id, digest, receipt.to_dict())
                return receipt

            unit.sessions.save(transition.state, expected_revision=state.revision)
            unit.events.append(transition.event)
            receipt = CommandReceipt(
                receipt_id=self._receipt_id_factory(),
                request_id=command.request_id,
                session_id=session_id,
                status="committed",
                revision=transition.state.revision,
                view_revision=transition.state.view_revision,
                interaction_epoch=transition.state.interaction_epoch,
                action=command.action,
                payload_digest=digest,
            )
            unit.receipts.save(session_id, command.request_id, digest, receipt.to_dict())
            return receipt

    def _rejected(
        self,
        command: _Command,
        session_id: str,
        digest: str,
        state: SessionState,
        reason: str,
    ) -> CommandReceipt:
        return CommandReceipt(
            receipt_id=self._receipt_id_factory(),
            request_id=command.request_id,
            session_id=session_id,
            status="rejected",
            revision=state.revision,
            view_revision=state.view_revision,
            interaction_epoch=state.interaction_epoch,
            action=command.action,
            payload_digest=digest,
            reason=reason[:200],
        )

    def _apply(self, state: SessionState, command: _Command) -> TransitionResult:
        if command.action == "open_artifact":
            artifact_id = _required_target(command)
            _find_document(self._pinned_packs(state), artifact_id, "artifacts/")
            if artifact_id in state.visible_entities:
                return focus_entity(state, artifact_id)
            updated = _next_state(
                state,
                focused_entity_id=artifact_id,
                visible_entities=(*state.visible_entities, artifact_id),
                display_order=(*state.display_order, artifact_id),
            )
            return _transition(updated, SessionEventKind.ARTIFACT_OPENED, entity_id=artifact_id)

        if command.action == "focus_detail":
            return focus_entity(state, _required_target(command))

        if command.action == "enter_story":
            story = _load_story(self._pinned_packs(state), _required_target(command))
            result = start_story(state, story)
            return TransitionResult(result.state, result.event)

        if command.action == "continue_story":
            if state.story_id is None:
                raise InvalidStoryAction("当前会话没有进行中的故事")
            if command.target_id is not None and command.target_id != state.story_id:
                raise InvalidStoryAction("继续命令的目标与当前故事不一致")
            story = _load_story(self._pinned_packs(state), state.story_id)
            result = advance_story(state, story, ExitAction.CONTINUE_STORY)
            return TransitionResult(result.state, result.event)

        if command.action == "return_to_story":
            return return_to_story(state)

        raise InvalidTransition(f"当前版本尚未开放该命令：{command.action}")

    def _pinned_packs(self, state: SessionState) -> tuple[PublishedPack, ...]:
        packs = []
        for pack_id, version in state.pack_versions.items():
            packs.append(self._catalog.get_published(pack_id, version))
        return tuple(packs)


def _parse_command(payload: Mapping[str, Any]) -> _Command:
    if not isinstance(payload, Mapping) or payload.get("schema_version") != "1":
        raise InvalidCommand("命令协议版本无效")
    allowed_fields = {
        "schema_version",
        "request_id",
        "expected_revision",
        "expected_view_revision",
        "interaction_epoch",
        "control_ticket",
        "action",
        "target_id",
        "params",
    }
    if set(payload) - allowed_fields:
        raise InvalidCommand("命令包含协议未定义字段")
    request_id = payload.get("request_id")
    if not isinstance(request_id, str) or not OPAQUE_ID.fullmatch(request_id):
        raise InvalidCommand("request_id必须是8至64位不透明标识")
    action = payload.get("action")
    if not isinstance(action, str) or action not in COMMAND_ACTIONS:
        raise InvalidCommand("命令动作不在协议枚举内")
    expected_revision = _non_negative_int(payload.get("expected_revision"), "expected_revision")
    interaction_epoch = _non_negative_int(payload.get("interaction_epoch"), "interaction_epoch")
    expected_view = payload.get("expected_view_revision")
    if expected_view is not None:
        expected_view = _non_negative_int(expected_view, "expected_view_revision")
    if action == "set_view" and expected_view is None:
        raise InvalidCommand("set_view必须携带expected_view_revision")
    target = payload.get("target_id")
    if target is not None and (not isinstance(target, str) or not NAMESPACED_ID.fullmatch(target)):
        raise InvalidCommand("target_id不是有效的命名空间标识")
    if (
        action in {"open_artifact", "enter_story", "focus_detail", "choose_action"}
        and target is None
    ):
        raise InvalidCommand(f"{action}必须提供target_id")
    ticket = payload.get("control_ticket")
    if (
        not isinstance(ticket, str)
        or not 8 <= len(ticket) <= 128
        or re.fullmatch(r"[A-Za-z0-9._-]+", ticket) is None
    ):
        raise InvalidCommand("控制票据缺失或长度无效")
    params = payload.get("params", {})
    if not isinstance(params, Mapping):
        raise InvalidCommand("params必须是对象")
    _validate_params(params)
    if action in {"set_view", "choose_action"} and "params" not in payload:
        raise InvalidCommand(f"{action}必须提供params")
    return _Command(
        request_id=request_id,
        expected_revision=expected_revision,
        interaction_epoch=interaction_epoch,
        action=action,
        target_id=target,
        expected_view_revision=expected_view,
        control_ticket=ticket,
        params=params,
    )


def _validate_params(params: Mapping[str, Any]) -> None:
    allowed = {"intent", "input_text", "camera"}
    if set(params) - allowed:
        raise InvalidCommand("params包含协议未定义字段")
    intent = params.get("intent")
    if intent is not None and (
        not isinstance(intent, str) or re.fullmatch(r"[a-z][a-z0-9_]{0,79}", intent) is None
    ):
        raise InvalidCommand("params.intent格式无效")
    input_text = params.get("input_text")
    if input_text is not None and (
        not isinstance(input_text, str) or not 1 <= len(input_text) <= 400
    ):
        raise InvalidCommand("params.input_text长度无效")
    camera = params.get("camera")
    if camera is not None:
        if not isinstance(camera, Mapping) or set(camera) != {"yaw", "pitch", "zoom"}:
            raise InvalidCommand("params.camera必须包含yaw、pitch和zoom")
        yaw, pitch, zoom = (camera[key] for key in ("yaw", "pitch", "zoom"))
        if (
            any(type(value) not in (int, float) for value in (yaw, pitch, zoom))
            or not -180 <= yaw <= 180
            or not -90 <= pitch <= 90
            or not 0 < zoom <= 8
        ):
            raise InvalidCommand("params.camera取值超出协议范围")


def _payload_digest(payload: Mapping[str, Any]) -> str:
    try:
        encoded = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise InvalidCommand("命令载荷不能规范化为JSON") from error
    return hashlib.sha256(encoded).hexdigest()


def _stale_reason(state: SessionState, command: _Command) -> str | None:
    if command.expected_revision != state.revision:
        return "会话修订号已变化，请先读取最新状态"
    if command.interaction_epoch != state.interaction_epoch:
        return "交互轮次已变化，拒绝执行过期命令"
    if command.action == "set_view" and command.expected_view_revision != state.view_revision:
        return "视图修订号已变化，请先读取最新状态"
    return None


def _required_target(command: _Command) -> str:
    if command.target_id is None:
        raise InvalidCommand("该动作缺少目标")
    return command.target_id


def _non_negative_int(value: object, field_name: str) -> int:
    if type(value) is not int or value < 0:
        raise InvalidCommand(f"{field_name}必须是非负整数")
    return value


def _next_state(state: SessionState, **changes: Any) -> SessionState:
    return replace(
        state,
        **changes,
        revision=state.revision + 1,
        view_revision=state.view_revision + 1,
        event_seq=state.event_seq + 1,
        interaction_epoch=state.interaction_epoch + 1,
    )


def _transition(
    state: SessionState,
    kind: SessionEventKind,
    *,
    entity_id: str | None = None,
) -> TransitionResult:
    return TransitionResult(
        state=state,
        event=SessionEvent(
            session_id=state.session_id,
            event_seq=state.event_seq,
            kind=kind,
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            entity_id=entity_id,
            story_id=state.story_id,
            node_id=state.node_id,
        ),
    )


def _find_document(
    packs: tuple[PublishedPack, ...], document_id: str, directory: str
) -> Mapping[str, Any]:
    for pack in packs:
        for path, document in pack.documents.items():
            if (
                path.startswith(directory)
                and isinstance(document, Mapping)
                and document.get("id") == document_id
            ):
                return document
    raise PinnedContentUnavailable(f"会话固定内容中找不到目标：{document_id}")


def _load_story(packs: tuple[PublishedPack, ...], story_id: str) -> StoryDefinition:
    story = _find_document(packs, story_id, "stories/")
    node_ids = story.get("node_ids")
    if not isinstance(node_ids, list) or not node_ids:
        raise InvalidStoryContent(f"故事没有节点清单：{story_id}")
    nodes: dict[str, StoryNode] = {}
    try:
        for node_id in node_ids:
            if not isinstance(node_id, str):
                raise InvalidStoryContent(f"故事节点标识无效：{story_id}")
            raw = _find_document(packs, node_id, "nodes/")
            if raw.get("story_id") != story_id:
                raise InvalidStoryContent(f"节点不属于当前故事：{node_id}")
            exits = tuple(
                StoryExit(
                    action=ExitAction(exit_item["action"]),
                    target_node_id=exit_item["target_node_id"],
                    when=_condition(exit_item.get("when")),
                )
                for exit_item in raw["exits"]
            )
            nodes[node_id] = StoryNode(
                id=node_id,
                story_id=story_id,
                allowed_actions=tuple(StoryAction(item) for item in raw["allowed_actions"]),
                exits=exits,
                enter_when=_condition(raw.get("enter_when")),
                effects=tuple(_effect(item) for item in raw.get("effects", [])),
            )
        return StoryDefinition(
            id=story_id,
            entry_node_id=story["entry_node_id"],
            nodes=nodes,
        )
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, InvalidStoryContent):
            raise
        raise InvalidStoryContent(f"发布故事结构无效：{story_id}") from error


def _condition(value: object) -> Condition | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise InvalidStoryRule("故事条件必须是对象")
    try:
        op = ConditionOp(value["op"])
        items = tuple(_condition(item) for item in value.get("items", []))
        return Condition(
            op=op,
            path=value.get("path"),
            value=value.get("value"),
            items=tuple(item for item in items if item is not None),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidStoryRule("发布故事包含无法解释的条件") from error


def _effect(value: object) -> Effect:
    if not isinstance(value, Mapping):
        raise InvalidStoryRule("故事效果必须是对象")
    try:
        return Effect(op=EffectOp(value["op"]), path=value["path"], value=value.get("value"))
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidStoryRule("发布故事包含无法解释的效果") from error
