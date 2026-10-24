from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from typing import Any


class IdempotencyConflict(RuntimeError):
    """A request identifier was reused for a different canonical payload."""


class SQLiteReceiptRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def get(self, session_id: str, request_id: str, payload_hash: str) -> dict[str, Any] | None:
        row = self._connection.execute(
            "SELECT payload_hash, receipt_json FROM command_receipts "
            "WHERE session_id = ? AND request_id = ?",
            (session_id, request_id),
        ).fetchone()
        if row is None:
            return None
        if row["payload_hash"] != payload_hash:
            raise IdempotencyConflict("相同请求ID不能用于不同命令内容")
        return json.loads(row["receipt_json"])

    def save(
        self,
        session_id: str,
        request_id: str,
        payload_hash: str,
        receipt: Mapping[str, Any],
    ) -> None:
        self._connection.execute(
            "INSERT INTO command_receipts(session_id, request_id, payload_hash, receipt_json) "
            "VALUES (?, ?, ?, ?)",
            (
                session_id,
                request_id,
                payload_hash,
                json.dumps(receipt, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
            ),
        )
