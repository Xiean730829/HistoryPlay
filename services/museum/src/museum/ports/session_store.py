from __future__ import annotations

from typing import Protocol

from museum.domain.session.models import SessionState


class SessionStore(Protocol):
    def get(self, session_id: str) -> SessionState | None: ...

    def create(self, state: SessionState) -> None: ...

    def save(self, state: SessionState, *, expected_revision: int) -> None: ...
