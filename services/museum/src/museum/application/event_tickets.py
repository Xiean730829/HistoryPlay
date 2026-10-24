from __future__ import annotations

import hashlib
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock


class InvalidEventTicket(PermissionError):
    """A browser event-channel grant is missing, expired, replayed, or out of scope."""


@dataclass(frozen=True, slots=True)
class _Ticket:
    session_id: str
    connection_id: str
    origin: str
    expires_at: float


class EventTickets:
    """Issues one-time, short-lived browser WebSocket grants without storing raw tokens."""

    TTL_SECONDS = 60

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._tickets: dict[bytes, _Ticket] = {}
        self._lock = RLock()

    def issue(self, *, session_id: str, connection_id: str, origin: str) -> str:
        if not session_id or not connection_id or not origin:
            raise ValueError("事件通道票据必须绑定会话、连接和来源")
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._purge_expired()
            self._tickets[self._digest(token)] = _Ticket(
                session_id=session_id,
                connection_id=connection_id,
                origin=origin,
                expires_at=self._clock() + self.TTL_SECONDS,
            )
        return token

    def consume(
        self,
        token: str,
        *,
        session_id: str,
        origin: str,
    ) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", token):
            raise InvalidEventTicket("事件通道票据无效或已使用")
        with self._lock:
            ticket = self._tickets.pop(self._digest(token), None)
            if ticket is None:
                raise InvalidEventTicket("事件通道票据无效或已使用")
            if self._clock() >= ticket.expires_at:
                raise InvalidEventTicket("事件通道票据已过期")
            if ticket.session_id != session_id or not secrets.compare_digest(
                ticket.origin, origin
            ):
                raise InvalidEventTicket("事件通道票据不属于当前会话或来源")
            return ticket.connection_id

    def _purge_expired(self) -> None:
        now = self._clock()
        expired = [key for key, ticket in self._tickets.items() if now >= ticket.expires_at]
        for key in expired:
            del self._tickets[key]

    @staticmethod
    def _digest(token: str) -> bytes:
        return hashlib.sha256(token.encode("ascii")).digest()
