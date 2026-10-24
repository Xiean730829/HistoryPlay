from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol


class CommandReceipts(Protocol):
    def get(self, session_id: str, request_id: str, payload_hash: str) -> dict[str, Any] | None: ...

    def save(
        self,
        session_id: str,
        request_id: str,
        payload_hash: str,
        receipt: Mapping[str, Any],
    ) -> None: ...
