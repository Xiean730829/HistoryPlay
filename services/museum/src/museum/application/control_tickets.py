from __future__ import annotations

import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock


class InvalidControlTicket(PermissionError):
    """Raised when a short-lived control grant is missing, expired, or out of scope."""


@dataclass(frozen=True, slots=True)
class _Ticket:
    session_id: str
    actor_id: str
    actions: frozenset[str]
    expires_at: float


class ControlTickets:
    """Issues in-process, short-lived grants scoped to one session and trusted actor."""

    MAX_TTL_SECONDS = 900

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        self._clock = clock
        self._token_factory = token_factory or (lambda: secrets.token_urlsafe(32))
        self._tickets: dict[str, _Ticket] = {}
        self._lock = RLock()

    def issue(
        self,
        *,
        session_id: str,
        actor_id: str,
        actions: frozenset[str],
        ttl_seconds: int = 300,
    ) -> str:
        if not session_id or not actor_id or not actions:
            raise ValueError("控制票据必须绑定会话、可信连接和允许动作")
        if not 1 <= ttl_seconds <= self.MAX_TTL_SECONDS:
            raise ValueError("控制票据有效期必须在1到900秒之间")
        token = self._token_factory()
        if not token or any(char not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for char in token):
            raise ValueError("票据生成器必须返回契约允许的短令牌")
        with self._lock:
            self._tickets[token] = _Ticket(
                session_id=session_id,
                actor_id=actor_id,
                actions=frozenset(actions),
                expires_at=self._clock() + ttl_seconds,
            )
        return token

    def validate(self, token: str, *, session_id: str, actor_id: str, action: str) -> None:
        with self._lock:
            ticket = self._tickets.get(token)
            if ticket is None:
                raise InvalidControlTicket("控制票据无效或已撤销")
            if self._clock() >= ticket.expires_at:
                del self._tickets[token]
                raise InvalidControlTicket("控制票据已过期")
            if ticket.session_id != session_id or ticket.actor_id != actor_id:
                raise InvalidControlTicket("控制票据不属于当前会话或可信连接")
            if action not in ticket.actions:
                raise InvalidControlTicket("控制票据未授权该动作")

    def revoke_actor(self, *, session_id: str, actor_id: str) -> int:
        with self._lock:
            revoked = [
                token
                for token, ticket in self._tickets.items()
                if ticket.session_id == session_id and ticket.actor_id == actor_id
            ]
            for token in revoked:
                del self._tickets[token]
        return len(revoked)
