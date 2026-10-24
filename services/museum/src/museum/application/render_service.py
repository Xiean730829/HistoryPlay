from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import Any

from museum.domain.session.models import SessionState


class StaleRenderReceipt(ValueError):
    """A renderer acknowledged a command that is no longer the current scene."""


class InvalidRenderReceipt(ValueError):
    """A renderer receipt does not match a committed command."""


@dataclass(frozen=True, slots=True)
class RenderReceipt:
    session_id: str
    connection_id: str
    request_id: str
    revision: int
    view_revision: int
    interaction_epoch: int
    status: str
    reason: str | None

    def to_dict(self, command_receipt: dict[str, Any]) -> dict[str, Any]:
        result = dict(command_receipt)
        result["status"] = self.status
        if self.reason is not None:
            result["reason"] = self.reason
        else:
            result.pop("reason", None)
        return result


class RenderService:
    """Records presentation acknowledgements without mutating authoritative session state."""

    def __init__(self) -> None:
        self._latest: dict[tuple[str, str], RenderReceipt] = {}
        self._lock = RLock()

    def latest(self, session_id: str, connection_id: str) -> RenderReceipt | None:
        with self._lock:
            return self._latest.get((session_id, connection_id))

    def report(
        self,
        *,
        state: SessionState,
        connection_id: str,
        request_id: str,
        revision: int,
        view_revision: int,
        interaction_epoch: int,
        status: str,
        reason: str | None,
    ) -> RenderReceipt:
        if status not in {"rendered", "degraded"}:
            raise InvalidRenderReceipt("呈现状态必须是rendered或degraded")
        if status == "degraded" and not reason:
            raise InvalidRenderReceipt("降级呈现必须说明实际展示的降级原因")
        if reason is not None and (not isinstance(reason, str) or len(reason) > 200):
            raise InvalidRenderReceipt("呈现原因必须是200字以内的文本")
        if status == "rendered" and reason is not None:
            raise InvalidRenderReceipt("正常呈现不能携带降级原因")
        if (
            revision != state.revision
            or view_revision != state.view_revision
            or interaction_epoch != state.interaction_epoch
        ):
            raise StaleRenderReceipt("会话已进入更新状态，忽略迟到的呈现回执")

        receipt = RenderReceipt(
            session_id=state.session_id,
            connection_id=connection_id,
            request_id=request_id,
            revision=revision,
            view_revision=view_revision,
            interaction_epoch=interaction_epoch,
            status=status,
            reason=reason,
        )
        key = (state.session_id, connection_id)
        with self._lock:
            previous = self._latest.get(key)
            if previous is not None and (
                previous.revision > revision
                or previous.view_revision > view_revision
                or previous.interaction_epoch > interaction_epoch
            ):
                raise StaleRenderReceipt("较旧的呈现回执不能覆盖当前状态")
            self._latest[key] = receipt
        return receipt
