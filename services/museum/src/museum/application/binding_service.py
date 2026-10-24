from __future__ import annotations

import secrets
from dataclasses import dataclass
from threading import RLock

from museum.application.control_tickets import ControlTickets

COMMAND_ACTIONS = frozenset(
    {
        "open_artifact",
        "enter_gallery",
        "move_next",
        "move_previous",
        "enter_story",
        "continue_story",
        "pause_story",
        "return_to_story",
        "focus_detail",
        "set_view",
        "choose_action",
    }
)


class InvalidBinding(PermissionError):
    """The connection is no longer the active trusted binding for this session."""


@dataclass(frozen=True, slots=True)
class SessionBinding:
    session_id: str
    connection_id: str
    control_ticket: str


class BindingService:
    """Keeps one active web connection per session and revokes its prior ticket."""

    def __init__(self, tickets: ControlTickets) -> None:
        self._tickets = tickets
        self._active: dict[str, str] = {}
        self._lock = RLock()

    def pair(self, session_id: str) -> SessionBinding:
        with self._lock:
            previous = self._active.get(session_id)
            if previous is not None:
                self._tickets.revoke_actor(session_id=session_id, actor_id=previous)
            connection_id = secrets.token_urlsafe(18)
            ticket = self._tickets.issue(
                session_id=session_id,
                actor_id=connection_id,
                actions=COMMAND_ACTIONS,
            )
            self._active[session_id] = connection_id
        return SessionBinding(session_id, connection_id, ticket)

    def require_active(self, session_id: str, connection_id: str | None) -> str:
        with self._lock:
            active = self._active.get(session_id)
            if (
                not connection_id
                or active is None
                or not secrets.compare_digest(active, connection_id)
            ):
                raise InvalidBinding("展台连接未绑定或已被新的配对替代")
            return active

    def revoke(self, session_id: str, connection_id: str) -> None:
        with self._lock:
            active = self._active.get(session_id)
            if active is not None and secrets.compare_digest(active, connection_id):
                del self._active[session_id]
                self._tickets.revoke_actor(session_id=session_id, actor_id=connection_id)
