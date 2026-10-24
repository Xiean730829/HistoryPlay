from __future__ import annotations

from typing import Protocol

from museum.domain.session.events import SessionEvent


class EventLog(Protocol):
    def append(self, event: SessionEvent) -> None: ...

    def replay(
        self, session_id: str, *, after_seq: int = 0, limit: int = 100
    ) -> tuple[SessionEvent, ...]: ...

    def pending(self, *, limit: int = 100) -> tuple[SessionEvent, ...]: ...

    def mark_dispatched(self, session_id: str, event_seq: int, dispatched_at: str) -> None: ...
