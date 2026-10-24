from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from typing import Any

from museum.domain.session.models import (
    HistoricalTime,
    NarrationCheckpoint,
    ReturnPoint,
    SessionMode,
    SessionState,
)


class SessionRevisionConflict(RuntimeError):
    """The session changed since the caller read it."""


class SessionAlreadyExists(RuntimeError):
    """A session with the same stable identifier already exists."""


class SQLiteSessionRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def get(self, session_id: str) -> SessionState | None:
        row = self._connection.execute(
            "SELECT state_json FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        return _decode_state(row["state_json"]) if row else None

    def create(self, state: SessionState) -> None:
        try:
            self._connection.execute(
                "INSERT INTO sessions(session_id, revision, state_json) VALUES (?, ?, ?)",
                (state.session_id, state.revision, _encode_state(state)),
            )
        except sqlite3.IntegrityError as exc:
            raise SessionAlreadyExists(f"会话已存在：{state.session_id}") from exc

    def save(self, state: SessionState, *, expected_revision: int) -> None:
        if state.revision != expected_revision + 1:
            raise ValueError("新会话修订号必须恰好递增一")
        cursor = self._connection.execute(
            "UPDATE sessions SET revision = ?, state_json = ? "
            "WHERE session_id = ? AND revision = ?",
            (state.revision, _encode_state(state), state.session_id, expected_revision),
        )
        if cursor.rowcount != 1:
            raise SessionRevisionConflict(f"会话修订号已变化：{state.session_id}")


def _encode_state(state: SessionState) -> str:
    payload = {
        "session_id": state.session_id,
        "pack_versions": dict(state.pack_versions),
        "mode": state.mode.value,
        "world_time": (
            {
                "start_year": state.world_time.start_year,
                "end_year": state.world_time.end_year,
                "precision": state.world_time.precision,
                "display_label": state.world_time.display_label,
            }
            if state.world_time
            else None
        ),
        "current_location_id": state.current_location_id,
        "focused_entity_id": state.focused_entity_id,
        "visible_entities": state.visible_entities,
        "display_order": state.display_order,
        "story_id": state.story_id,
        "node_id": state.node_id,
        "story_variables": dict(state.story_variables),
        "return_stack": [
            {
                "story_id": point.story_id,
                "node_id": point.node_id,
                "revision": point.revision,
                "story_variables": dict(point.story_variables),
                "narration_checkpoint": _encode_checkpoint(point.narration_checkpoint),
            }
            for point in state.return_stack
        ],
        "revision": state.revision,
        "view_revision": state.view_revision,
        "event_seq": state.event_seq,
        "interaction_epoch": state.interaction_epoch,
        "discoveries": sorted(state.discoveries),
        "narration_checkpoint": _encode_checkpoint(state.narration_checkpoint),
    }
    return json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _decode_state(raw: str) -> SessionState:
    payload: dict[str, Any] = json.loads(raw)
    world_time = payload["world_time"]
    return SessionState(
        session_id=payload["session_id"],
        pack_versions=payload["pack_versions"],
        mode=SessionMode(payload["mode"]),
        world_time=HistoricalTime(**world_time) if world_time else None,
        current_location_id=payload["current_location_id"],
        focused_entity_id=payload["focused_entity_id"],
        visible_entities=tuple(payload["visible_entities"]),
        display_order=tuple(payload["display_order"]),
        story_id=payload["story_id"],
        node_id=payload["node_id"],
        story_variables=payload["story_variables"],
        return_stack=tuple(
            ReturnPoint(
                story_id=point["story_id"],
                node_id=point["node_id"],
                revision=point["revision"],
                story_variables=point["story_variables"],
                narration_checkpoint=_decode_checkpoint(point["narration_checkpoint"]),
            )
            for point in payload["return_stack"]
        ),
        revision=payload["revision"],
        view_revision=payload["view_revision"],
        event_seq=payload["event_seq"],
        interaction_epoch=payload["interaction_epoch"],
        discoveries=frozenset(payload["discoveries"]),
        narration_checkpoint=_decode_checkpoint(payload["narration_checkpoint"]),
    )


def _encode_checkpoint(checkpoint: NarrationCheckpoint | None) -> Mapping[str, str | None] | None:
    if checkpoint is None:
        return None
    return {
        "last_started_node_id": checkpoint.last_started_node_id,
        "last_completed_node_id": checkpoint.last_completed_node_id,
    }


def _decode_checkpoint(value: Mapping[str, str | None] | None) -> NarrationCheckpoint | None:
    return NarrationCheckpoint(**value) if value else None
