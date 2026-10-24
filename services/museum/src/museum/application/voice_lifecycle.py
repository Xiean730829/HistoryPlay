from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from threading import RLock
from uuid import uuid4

from museum.application.command_service import COMMAND_ACTIONS


class StaleVoiceInput(PermissionError):
    """A transport/input grant has expired, been replaced, or was already consumed."""


@dataclass
class _Input:
    token: str = field(repr=False)
    revision: int
    view_revision: int
    epoch: int
    expires: float
    consumed: bool = False


@dataclass
class _Bridge:
    token: str = field(repr=False)
    session_id: str
    actor_id: str
    current: _Input | None = None


class VoiceLifecycle:
    """One-shot trusted input gate, serialized with revocation and command submission.

    Cloud tools cannot create a grant. Reading context never refreshes a grant.
    No duplicate game state: all positions/story changes use CommandService.
    """

    def __init__(self, database, commands, bindings, tickets, *, clock=time.monotonic):
        self.database, self.commands = database, commands
        self.bindings, self.tickets, self.clock = bindings, tickets, clock
        self._bridges: dict[str, _Bridge] = {}
        self._lock = RLock()

    def bind(self, session_id: str, actor_id: str) -> str:
        with self._lock:
            self.bindings.require_active(session_id, actor_id)
            token = secrets.token_urlsafe(32)
            self._bridges[session_id] = _Bridge(token, session_id, actor_id)
            return token

    def _bridge(self, session_id: str, actor_id: str, token: str) -> _Bridge:
        self.bindings.require_active(session_id, actor_id)
        bridge = self._bridges.get(session_id)
        if (
            bridge is None
            or bridge.actor_id != actor_id
            or not secrets.compare_digest(bridge.token, token)
        ):
            raise StaleVoiceInput("语音桥绑定已失效")
        return bridge

    def begin(self, session_id: str, actor_id: str, bridge_token: str) -> str:
        with self._lock:
            bridge = self._bridge(session_id, actor_id, bridge_token)
            with self.database.read() as unit:
                state = unit.sessions.get(session_id)
            if state is None:
                raise StaleVoiceInput("展台已失效")
            token = secrets.token_urlsafe(32)
            bridge.current = _Input(
                token,
                state.revision,
                state.view_revision,
                state.interaction_epoch,
                self.clock() + 90,
            )
            return token

    def cancel(self, session_id: str, actor_id: str, bridge_token: str, input_token: str) -> None:
        with self._lock:
            bridge = self._bridge(session_id, actor_id, bridge_token)
            if bridge.current and secrets.compare_digest(bridge.current.token, input_token):
                bridge.current = None

    def execute(
        self,
        session_id: str,
        actor_id: str,
        bridge_token: str,
        input_token: str,
        action: str,
        *,
        target_id=None,
        params=None,
    ) -> dict:
        with self._lock:
            bridge = self._bridge(session_id, actor_id, bridge_token)
            scope = bridge.current
            if (
                scope is None
                or not secrets.compare_digest(scope.token, input_token)
                or scope.consumed
                or self.clock() >= scope.expires
            ):
                raise StaleVoiceInput("旧语音输入已撤销、过期或已执行")
            if action not in COMMAND_ACTIONS:
                raise ValueError("语音动作未开放")
            scope.consumed = True
            ticket = self.tickets.issue(
                session_id=session_id,
                actor_id=actor_id,
                actions=frozenset({action}),
                ttl_seconds=90,
            )
            payload = {
                "schema_version": "1",
                "request_id": uuid4().hex,
                "expected_revision": scope.revision,
                "expected_view_revision": scope.view_revision,
                "interaction_epoch": scope.epoch,
                "control_ticket": ticket,
                "action": action,
            }
            if target_id is not None:
                payload["target_id"] = target_id
            if params is not None:
                payload["params"] = params
            return self.commands.execute(session_id, actor_id, payload).to_dict()
