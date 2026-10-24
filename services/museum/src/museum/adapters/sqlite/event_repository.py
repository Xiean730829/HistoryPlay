from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict

from museum.domain.session.events import SessionEvent, SessionEventKind


class EventSequenceConflict(RuntimeError):
    """An event sequence is duplicated or would create a gap."""


class SQLiteEventRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def append(self, event: SessionEvent) -> None:
        current = self._connection.execute(
            "SELECT MAX(event_seq) FROM session_events WHERE session_id = ?",
            (event.session_id,),
        ).fetchone()[0]
        if event.event_seq != (current or 0) + 1:
            raise EventSequenceConflict("事件序号必须从1开始且连续递增")
        payload = asdict(event)
        payload["kind"] = event.kind.value
        self._connection.execute(
            "INSERT INTO session_events(session_id, event_seq, event_json) VALUES (?, ?, ?)",
            (
                event.session_id,
                event.event_seq,
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            ),
        )
        self._connection.execute(
            "INSERT INTO event_outbox(session_id, event_seq) VALUES (?, ?)",
            (event.session_id, event.event_seq),
        )

    def replay(
        self, session_id: str, *, after_seq: int = 0, limit: int = 100
    ) -> tuple[SessionEvent, ...]:
        if after_seq < 0 or not 1 <= limit <= 500:
            raise ValueError("事件重放游标或分页大小无效")
        rows = self._connection.execute(
            "SELECT event_json FROM session_events WHERE session_id = ? AND event_seq > ? "
            "ORDER BY event_seq LIMIT ?",
            (session_id, after_seq, limit),
        ).fetchall()
        return tuple(_decode_event(row["event_json"]) for row in rows)

    def pending(self, *, limit: int = 100) -> tuple[SessionEvent, ...]:
        if not 1 <= limit <= 500:
            raise ValueError("outbox分页大小无效")
        rows = self._connection.execute(
            "SELECT e.event_json FROM event_outbox o "
            "JOIN session_events e USING(session_id, event_seq) "
            "WHERE o.dispatched_at IS NULL ORDER BY o.created_at, o.session_id, o.event_seq LIMIT ?",
            (limit,),
        ).fetchall()
        return tuple(_decode_event(row["event_json"]) for row in rows)

    def mark_dispatched(self, session_id: str, event_seq: int, dispatched_at: str) -> None:
        cursor = self._connection.execute(
            "UPDATE event_outbox SET dispatched_at = ? "
            "WHERE session_id = ? AND event_seq = ? AND dispatched_at IS NULL",
            (dispatched_at, session_id, event_seq),
        )
        if cursor.rowcount != 1:
            raise KeyError("待发送事件不存在或已经标记发送")


def _decode_event(raw: str) -> SessionEvent:
    payload = json.loads(raw)
    payload["kind"] = SessionEventKind(payload["kind"])
    return SessionEvent(**payload)
