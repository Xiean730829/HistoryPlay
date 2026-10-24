import json
from dataclasses import replace

import pytest
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.adapters.sqlite.event_repository import EventSequenceConflict
from museum.adapters.sqlite.receipt_repository import IdempotencyConflict
from museum.adapters.sqlite.session_repository import (
    SessionRevisionConflict,
    _decode_state,
    _encode_state,
)
from museum.domain.session.events import SessionEvent, SessionEventKind
from museum.domain.session.models import (
    CameraPose,
    ExhibitReturnPoint,
    HistoricalTime,
    NarrationCheckpoint,
    ReturnPoint,
    SessionMode,
    SessionState,
)


def make_state() -> SessionState:
    return SessionState(
        session_id="sess_sqlite_01",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.QA,
        world_time=HistoricalTime(678, 690, "range", "武周时期"),
        focused_entity_id="artifact.stele",
        visible_entities=("artifact.stele",),
        display_order=("artifact.stele",),
        story_id="story.observation",
        node_id="node.observation.02",
        story_variables={"trust": 2, "remembered": True},
        return_stack=(
            ReturnPoint(
                story_id="story.observation",
                node_id="node.observation.01",
                revision=3,
                story_variables={"trust": 1},
                narration_checkpoint=NarrationCheckpoint("node.observation.01", None),
            ),
        ),
        revision=4,
        view_revision=2,
        event_seq=3,
        interaction_epoch=5,
        discoveries=frozenset({"artifact.stele.date"}),
        narration_checkpoint=NarrationCheckpoint("node.observation.02", "node.observation.01"),
    )


def make_event(session_id: str, event_seq: int) -> SessionEvent:
    return SessionEvent(
        session_id=session_id,
        event_seq=event_seq,
        kind=SessionEventKind.STORY_ADVANCED,
        revision=event_seq,
        interaction_epoch=event_seq,
        story_id="story.observation",
        node_id=f"node.observation.0{event_seq}",
    )


def test_session_snapshot_round_trips_immutable_nested_state(tmp_path) -> None:
    database = SQLiteDatabase(tmp_path / "museum.sqlite3")
    state = make_state()

    with database.transaction() as unit:
        unit.sessions.create(state)
    with database.transaction() as unit:
        loaded = unit.sessions.get(state.session_id)

    assert loaded == state
    assert loaded is not None
    assert loaded.pack_versions == state.pack_versions
    assert loaded.return_stack[0].narration_checkpoint == state.return_stack[0].narration_checkpoint


def test_session_snapshot_persists_root_exhibit_anchor_and_reads_legacy_json() -> None:
    state = replace(
        make_state(),
        exhibit_return_point=ExhibitReturnPoint(
            gallery_id="cn.tang.gallery.main",
            station_id="cn.tang.station.ox",
            focused_entity_id="artifact.ox",
            view=CameraPose(yaw=22, pitch=-4, zoom=1.5),
            view_revision=7,
        ),
        camera_pose=CameraPose(yaw=22, pitch=-4, zoom=1.5),
    )
    assert _decode_state(_encode_state(state)) == state

    legacy = json.loads(_encode_state(state))
    legacy.pop("camera_pose")
    legacy.pop("exhibit_return_point")
    restored = _decode_state(json.dumps(legacy))
    assert restored.camera_pose == CameraPose()
    assert restored.exhibit_return_point is None


def test_session_save_uses_optimistic_revision_and_exact_increment(tmp_path) -> None:
    database = SQLiteDatabase(tmp_path / "museum.sqlite3")
    state = make_state()
    with database.transaction() as unit:
        unit.sessions.create(state)

    changed = replace(state, revision=5, event_seq=4)
    with database.transaction() as unit:
        unit.sessions.save(changed, expected_revision=4)
    with database.transaction() as unit:
        with pytest.raises(SessionRevisionConflict):
            unit.sessions.save(changed, expected_revision=4)
        with pytest.raises(ValueError, match="恰好递增"):
            unit.sessions.save(replace(changed, revision=7), expected_revision=5)


def test_receipt_is_idempotent_only_for_same_payload_hash(tmp_path) -> None:
    database = SQLiteDatabase(tmp_path / "museum.sqlite3")
    state = replace(
        make_state(), mode=SessionMode.EXPLORE, story_id=None, node_id=None, return_stack=()
    )
    with database.transaction() as unit:
        unit.sessions.create(state)
        unit.receipts.save(state.session_id, "req-1", "sha256:a", {"status": "committed"})

    with database.transaction() as unit:
        assert unit.receipts.get(state.session_id, "req-1", "sha256:a") == {"status": "committed"}
        with pytest.raises(IdempotencyConflict):
            unit.receipts.get(state.session_id, "req-1", "sha256:b")


def test_event_sequence_replay_outbox_and_dispatch_marker(tmp_path) -> None:
    database = SQLiteDatabase(tmp_path / "museum.sqlite3")
    state = replace(
        make_state(), mode=SessionMode.EXPLORE, story_id=None, node_id=None, return_stack=()
    )
    with database.transaction() as unit:
        unit.sessions.create(state)
        unit.events.append(make_event(state.session_id, 1))
        unit.events.append(make_event(state.session_id, 2))

    with database.transaction() as unit:
        assert tuple(
            event.event_seq for event in unit.events.replay(state.session_id, after_seq=1)
        ) == (2,)
        assert tuple(event.event_seq for event in unit.events.pending()) == (1, 2)
        unit.events.mark_dispatched(state.session_id, 1, "2026-10-24T01:02:00Z")
        assert tuple(event.event_seq for event in unit.events.pending()) == (2,)
        with pytest.raises(KeyError):
            unit.events.mark_dispatched(state.session_id, 1, "2026-10-24T01:02:01Z")
        with pytest.raises(EventSequenceConflict):
            unit.events.append(make_event(state.session_id, 4))


def test_session_receipt_and_event_share_commit_or_rollback(tmp_path) -> None:
    database = SQLiteDatabase(tmp_path / "museum.sqlite3")
    state = replace(
        make_state(), mode=SessionMode.EXPLORE, story_id=None, node_id=None, return_stack=()
    )
    with pytest.raises(RuntimeError, match="rollback"), database.transaction() as unit:
        unit.sessions.create(state)
        unit.receipts.save(state.session_id, "req-rollback", "sha256:c", {"status": "committed"})
        unit.events.append(make_event(state.session_id, 1))
        raise RuntimeError("rollback")

    with database.transaction() as unit:
        assert unit.sessions.get(state.session_id) is None
        assert unit.receipts.get(state.session_id, "req-rollback", "sha256:c") is None
        assert unit.events.replay(state.session_id) == ()
