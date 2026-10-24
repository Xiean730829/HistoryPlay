from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.adapters.sqlite.receipt_repository import IdempotencyConflict
from museum.application.command_service import CommandService
from museum.application.control_tickets import ControlTickets, InvalidControlTicket
from museum.domain.session.models import SessionMode, SessionState
from museum.ports.content_catalog import PublishedPack

PACK_ID = "cn.tang.core"
VERSION = "1.0.0"
STORY_ID = "cn.tang.story.observe"
NODE_ONE = "cn.tang.node.observe.one"
NODE_TWO = "cn.tang.node.observe.two"
ACTOR_ID = "web.console.01"


class MemoryCatalog:
    def __init__(self) -> None:
        self.pack = PublishedPack(
            PACK_ID,
            VERSION,
            "1",
            {
                "stories/observe.json": {
                    "id": STORY_ID,
                    "title": "观察故事",
                    "entry_node_id": NODE_ONE,
                    "node_ids": [NODE_ONE, NODE_TWO],
                },
                "nodes/one.json": {
                    "id": NODE_ONE,
                    "story_id": STORY_ID,
                    "fact_grade": "F",
                    "allowed_actions": ["continue_story"],
                    "exits": [{"action": "continue_story", "target_node_id": NODE_TWO}],
                    "effects": [{"op": "set", "path": "step", "value": 1}],
                },
                "nodes/two.json": {
                    "id": NODE_TWO,
                    "story_id": STORY_ID,
                    "fact_grade": "F",
                    "allowed_actions": ["continue_story"],
                    "exits": [{"action": "continue_story", "target_node_id": NODE_TWO}],
                },
                "artifacts/stele.json": {"id": "cn.tang.artifact.stele"},
                "artifacts/coin.json": {"id": "cn.tang.artifact.coin"},
                "artifacts/ox.json": {"id": "cn.tang.artifact.ox"},
                "artifacts/bowl.json": {"id": "cn.tang.artifact.bowl"},
                "galleries/tang.json": {
                    "id": "cn.tang.gallery.main",
                    "status": "open",
                    "default_station_id": "cn.tang.station.stele",
                    "stations": [
                        {
                            "id": "cn.tang.station.stele",
                            "order": 0,
                            "artifact_id": "cn.tang.artifact.stele",
                            "time_range": {
                                "start_year": 678,
                                "end_year": 690,
                                "precision": "range",
                            },
                        },
                        {
                            "id": "cn.tang.station.coin",
                            "order": 1,
                            "artifact_id": "cn.tang.artifact.coin",
                            "comparison_artifact_ids": ["cn.tang.artifact.bowl"],
                            "time_range": {
                                "start_year": 713,
                                "end_year": 741,
                                "precision": "range",
                            },
                        },
                        {
                            "id": "cn.tang.station.ox",
                            "order": 2,
                            "artifact_id": "cn.tang.artifact.ox",
                            "time_range": {
                                "start_year": 713,
                                "end_year": 741,
                                "precision": "range",
                            },
                        },
                    ],
                },
            },
        )

    def list_published(self):
        raise AssertionError("命令只能使用会话固定版本")

    def get_published(self, pack_id: str, version: str) -> PublishedPack:
        if (pack_id, version) != (PACK_ID, VERSION):
            raise LookupError("内容包版本不可用")
        return self.pack


def make_state() -> SessionState:
    return SessionState(
        session_id="session-0001",
        pack_versions={PACK_ID: VERSION},
        mode=SessionMode.STORY,
        focused_entity_id="cn.tang.artifact.stele",
        visible_entities=("cn.tang.artifact.stele",),
        display_order=("cn.tang.artifact.stele",),
        story_id=STORY_ID,
        node_id=NODE_ONE,
        revision=4,
        event_seq=0,
        interaction_epoch=2,
    )


def make_service(tmp_path):
    database = SQLiteDatabase(tmp_path / "command.sqlite3")
    state = make_state()
    with database.transaction() as unit:
        unit.sessions.create(state)
    tickets = ControlTickets()
    token = tickets.issue(
        session_id=state.session_id,
        actor_id=ACTOR_ID,
        actions=frozenset(
            {
                "continue_story",
                "open_artifact",
                "enter_gallery",
                "move_next",
                "move_previous",
                "locate_artifact",
                "enter_story",
                "return_to_exhibit",
                "set_view",
            }
        ),
    )
    return database, state, tickets, token, CommandService(
        database.transaction, MemoryCatalog(), tickets
    )


def command(token: str, request_id: str = "request-0001") -> dict:
    return {
        "schema_version": "1",
        "request_id": request_id,
        "expected_revision": 4,
        "interaction_epoch": 2,
        "action": "continue_story",
        "control_ticket": token,
    }


def test_same_request_returns_original_receipt_without_advancing_twice(tmp_path) -> None:
    database, state, _, token, service = make_service(tmp_path)
    payload = command(token)

    first = service.execute(state.session_id, ACTOR_ID, payload)
    retry = service.execute(state.session_id, ACTOR_ID, payload)

    assert retry == first
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
        events = unit.events.replay(state.session_id, after_seq=state.event_seq)
    assert saved is not None
    assert (saved.node_id, saved.revision, saved.event_seq) == (NODE_TWO, 5, 1)
    assert len(events) == 1


def test_same_request_id_with_different_payload_is_a_conflict(tmp_path) -> None:
    _, state, _, token, service = make_service(tmp_path)
    service.execute(state.session_id, ACTOR_ID, command(token))
    changed = command(token)
    changed["params"] = {"intent": "continue_story"}

    with pytest.raises(IdempotencyConflict):
        service.execute(state.session_id, ACTOR_ID, changed)


def test_concurrent_continue_commands_with_same_revision_only_advance_once(tmp_path) -> None:
    database, state, _, token, service = make_service(tmp_path)
    payloads = [command(token, "request-0001"), command(token, "request-0002")]

    with ThreadPoolExecutor(max_workers=2) as executor:
        receipts = list(
            executor.map(
                lambda payload: service.execute(state.session_id, ACTOR_ID, payload), payloads
            )
        )

    assert sorted(receipt.status for receipt in receipts) == ["committed", "rejected"]
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
        events = unit.events.replay(state.session_id, after_seq=state.event_seq)
    assert saved is not None
    assert (saved.node_id, saved.revision, saved.event_seq) == (NODE_TWO, 5, 1)
    assert len(events) == 1


def test_control_ticket_cannot_be_used_by_another_actor_or_session(tmp_path) -> None:
    database, state, _, token, service = make_service(tmp_path)

    other_state = replace(state, session_id="session-0002")
    with database.transaction() as unit:
        unit.sessions.create(other_state)
    with pytest.raises(InvalidControlTicket):
        service.execute(state.session_id, "attacker.01", command(token))

    with pytest.raises(InvalidControlTicket):
        service.execute("session-0002", ACTOR_ID, command(token))


def test_control_ticket_expires_and_cannot_authorize_another_action() -> None:
    now = [10.0]
    tickets = ControlTickets(clock=lambda: now[0], token_factory=lambda: "short-lived-token")
    token = tickets.issue(
        session_id="session-0001",
        actor_id=ACTOR_ID,
        actions=frozenset({"continue_story"}),
        ttl_seconds=2,
    )

    with pytest.raises(InvalidControlTicket, match="未授权"):
        tickets.validate(token, session_id="session-0001", actor_id=ACTOR_ID, action="open_artifact")
    now[0] += 2
    with pytest.raises(InvalidControlTicket, match="过期"):
        tickets.validate(token, session_id="session-0001", actor_id=ACTOR_ID, action="continue_story")


def test_stale_request_is_rejected_and_receipt_is_stable(tmp_path) -> None:
    database, state, tickets, token, service = make_service(tmp_path)
    newer_state = replace(state, revision=5, event_seq=1, interaction_epoch=3)
    with database.transaction() as unit:
        unit.sessions.save(newer_state, expected_revision=4)
    payload = command(token)

    first = service.execute(state.session_id, ACTOR_ID, payload)
    retry = service.execute(state.session_id, ACTOR_ID, payload)

    assert first.status == "rejected"
    assert retry == first
    with database.transaction() as unit:
        assert unit.sessions.get(state.session_id) == newer_state
        assert unit.events.replay(state.session_id, after_seq=state.event_seq) == ()
    assert tickets.revoke_actor(session_id=state.session_id, actor_id=ACTOR_ID) == 1


def _navigation_command(
    token: str,
    *,
    action: str,
    revision: int,
    interaction_epoch: int,
    view_revision: int,
    request_id: str = "navigation-0001",
    target_id: str | None = None,
) -> dict:
    payload = {
        "schema_version": "1",
        "request_id": request_id,
        "expected_revision": revision,
        "expected_view_revision": view_revision,
        "interaction_epoch": interaction_epoch,
        "action": action,
        "control_ticket": token,
    }
    if target_id is not None:
        payload["target_id"] = target_id
    return payload


def _exploration_service(tmp_path):
    database, state, _, token, service = make_service(tmp_path)
    exploring = replace(
        state,
        mode=SessionMode.EXPLORE,
        focused_entity_id=None,
        visible_entities=(),
        display_order=(),
        story_id=None,
        node_id=None,
        revision=state.revision + 1,
    )
    with database.transaction() as unit:
        unit.sessions.save(exploring, expected_revision=state.revision)
    return database, exploring, token, service


def test_gallery_navigation_enters_and_moves_one_station_with_idempotent_retries(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    enter = _navigation_command(
        token,
        action="enter_gallery",
        request_id="navigation-enter-0001",
        target_id="cn.tang.gallery.main",
        revision=state.revision,
        interaction_epoch=state.interaction_epoch,
        view_revision=state.view_revision,
    )

    entered = service.execute(state.session_id, ACTOR_ID, enter)
    assert entered.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.current_location_id == "cn.tang.station.stele"
    assert saved.focused_entity_id == "cn.tang.artifact.stele"
    assert saved.world_time is not None and saved.world_time.start_year == 678

    move = _navigation_command(
        token,
        action="move_next",
        request_id="navigation-move-0001",
        revision=entered.revision,
        interaction_epoch=entered.interaction_epoch,
        view_revision=entered.view_revision,
    )
    moved = service.execute(state.session_id, ACTOR_ID, move)
    retry = service.execute(state.session_id, ACTOR_ID, move)
    assert moved.status == "committed"
    assert retry == moved
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
        events = unit.events.replay(state.session_id, after_seq=state.event_seq)
    assert saved is not None
    assert saved.gallery_id == "cn.tang.gallery.main"
    assert saved.station_id == "cn.tang.station.coin"
    assert saved.current_location_id == "cn.tang.station.coin"
    assert saved.focused_entity_id == "cn.tang.artifact.coin"
    assert "cn.tang.artifact.bowl" in saved.visible_entities
    assert saved.world_time is not None and saved.world_time.start_year == 713
    assert len(events) == 2


def test_reentering_current_gallery_keeps_the_current_station(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    entered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            request_id="navigation-repeat-enter-0001",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
        ),
    )
    moved = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="move_next",
            request_id="navigation-repeat-move-0001",
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
        ),
    )

    repeated = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            request_id="navigation-repeat-enter-0002",
            target_id="cn.tang.gallery.main",
            revision=moved.revision,
            interaction_epoch=moved.interaction_epoch,
            view_revision=moved.view_revision,
        ),
    )

    assert repeated.status == "rejected"
    assert repeated.reason == "已在该展厅，当前位置保持不变"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.gallery_id == "cn.tang.gallery.main"
    assert saved.station_id == "cn.tang.station.coin"
    assert saved.focused_entity_id == "cn.tang.artifact.coin"
    assert saved.revision == moved.revision


def test_gallery_navigation_rejects_boundaries_without_changing_state(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    entered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            request_id="navigation-enter-0002",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
        ),
    )
    first = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="move_previous",
            request_id="navigation-prev-0001",
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
        ),
    )
    assert first.status == "rejected"
    assert "入口" in (first.reason or "")
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.current_location_id == "cn.tang.station.stele"
    assert saved.revision == entered.revision

    latest = entered
    for index, station_id in enumerate(("cn.tang.station.coin", "cn.tang.station.ox")):
        latest = service.execute(
            state.session_id,
            ACTOR_ID,
            _navigation_command(
                token,
                action="move_next",
                revision=latest.revision,
                interaction_epoch=latest.interaction_epoch,
                view_revision=latest.view_revision,
                request_id=f"navigation-next-{index:04d}",
            ),
        )
        assert latest.status == "committed"
        with database.transaction() as unit:
            saved = unit.sessions.get(state.session_id)
        assert saved is not None and saved.current_location_id == station_id

    last = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="move_next",
            revision=latest.revision,
            interaction_epoch=latest.interaction_epoch,
            view_revision=latest.view_revision,
            request_id="navigation-last-0001",
        ),
    )
    assert last.status == "rejected"
    assert "末尾" in (last.reason or "")
    with database.transaction() as unit:
        assert unit.sessions.get(state.session_id).revision == latest.revision


def test_navigation_requires_current_view_revision_and_exploration_mode(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    stale = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            request_id="navigation-enter-stale",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision + 1,
        ),
    )
    assert stale.status == "rejected"
    assert "视图修订号" in (stale.reason or "")

    story_state = replace(
        state,
        mode=SessionMode.STORY,
        focused_entity_id="cn.tang.artifact.stele",
        visible_entities=("cn.tang.artifact.stele",),
        display_order=("cn.tang.artifact.stele",),
        story_id=STORY_ID,
        node_id=NODE_ONE,
        revision=state.revision + 1,
    )
    with database.transaction() as unit:
        unit.sessions.save(story_state, expected_revision=state.revision)
    blocked = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            revision=story_state.revision,
            interaction_epoch=story_state.interaction_epoch,
            view_revision=story_state.view_revision,
            request_id="navigation-story-0001",
        ),
    )
    assert blocked.status == "rejected"
    assert "探索模式" in (blocked.reason or "")


def test_locate_artifact_moves_directly_to_its_pinned_primary_station(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    entered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
            request_id="navigation-enter-locate",
        ),
    )
    located = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.tang.artifact.ox",
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="navigation-locate-ox",
        ),
    )
    assert located.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.gallery_id == "cn.tang.gallery.main"
    assert saved.station_id == "cn.tang.station.ox"
    assert saved.current_location_id == "cn.tang.station.ox"
    assert saved.focused_entity_id == "cn.tang.artifact.ox"
    assert "cn.tang.artifact.ox" in saved.visible_entities


def test_locate_artifact_rejects_comparison_only_artifacts_without_moving(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    entered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
            request_id="navigation-enter-comparison",
        ),
    )
    located = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.tang.artifact.bowl",
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="navigation-locate-bowl",
        ),
    )
    assert located.status == "rejected"
    assert "已开放的主展位" in (located.reason or "")
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.station_id == "cn.tang.station.stele"
    assert saved.focused_entity_id == "cn.tang.artifact.stele"
    assert saved.revision == entered.revision


def test_story_entry_captures_root_anchor_and_return_restores_station_and_camera(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    entered_gallery = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
            request_id="story-return-enter-gallery",
        ),
    )
    view = _navigation_command(
        token,
        action="set_view",
        revision=entered_gallery.revision,
        interaction_epoch=entered_gallery.interaction_epoch,
        view_revision=entered_gallery.view_revision,
        request_id="story-return-set-view",
    )
    view["params"] = {"camera": {"yaw": 32, "pitch": -8, "zoom": 1.7}}
    changed_view = service.execute(state.session_id, ACTOR_ID, view)
    started = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_story",
            target_id=STORY_ID,
            revision=changed_view.revision,
            interaction_epoch=changed_view.interaction_epoch,
            view_revision=changed_view.view_revision,
            request_id="story-return-enter-story",
        ),
    )
    with database.transaction() as unit:
        story_state = unit.sessions.get(state.session_id)
    assert story_state is not None and story_state.exhibit_return_point is not None
    assert story_state.exhibit_return_point.station_id == "cn.tang.station.stele"

    returned = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="return_to_exhibit",
            revision=started.revision,
            interaction_epoch=started.interaction_epoch,
            view_revision=started.view_revision,
            request_id="story-return-to-exhibit",
        ),
    )
    assert returned.status == "committed"
    with database.transaction() as unit:
        restored = unit.sessions.get(state.session_id)
    assert restored is not None
    assert restored.mode == SessionMode.EXPLORE
    assert restored.station_id == "cn.tang.station.stele"
    assert restored.focused_entity_id == "cn.tang.artifact.stele"
    assert restored.camera_pose.yaw == 32 and restored.camera_pose.zoom == 1.7
    assert restored.exhibit_return_point is None
