from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from museum.adapters.sqlite.database import SQLiteDatabase
from museum.adapters.sqlite.receipt_repository import IdempotencyConflict
from museum.application.command_service import CommandService, InvalidCommand
from museum.application.control_tickets import ControlTickets, InvalidControlTicket
from museum.domain.session.models import SessionMode, SessionState
from museum.ports.content_catalog import PublishedPack

PACK_ID = "cn.tang.core"
VERSION = "1.0.0"
STORY_ID = "cn.tang.story.observe"
NODE_ONE = "cn.tang.node.observe.one"
NODE_TWO = "cn.tang.node.observe.two"
NODE_THREE = "cn.tang.node.observe.three"
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
                    "node_ids": [NODE_ONE, NODE_TWO, NODE_THREE],
                },
                "nodes/one.json": {
                    "id": NODE_ONE,
                    "story_id": STORY_ID,
                    "fact_grade": "F",
                    "allowed_actions": ["continue_story", "choose_route"],
                    "exits": [
                        {"action": "continue_story", "target_node_id": NODE_TWO},
                        {"action": "choose_route", "target_node_id": NODE_TWO},
                        {"action": "choose_route", "target_node_id": NODE_THREE},
                    ],
                    "effects": [{"op": "set", "path": "step", "value": 1}],
                },
                "nodes/two.json": {
                    "id": NODE_TWO,
                    "story_id": STORY_ID,
                    "fact_grade": "F",
                    "allowed_actions": ["continue_story"],
                    "exits": [{"action": "continue_story", "target_node_id": NODE_TWO}],
                },
                "nodes/three.json": {
                    "id": NODE_THREE,
                    "story_id": STORY_ID,
                    "fact_grade": "C",
                    "allowed_actions": ["continue_story"],
                    "exits": [{"action": "continue_story", "target_node_id": NODE_THREE}],
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
        if (pack_id, version) != (self.pack.pack_id, self.pack.version):
            raise LookupError("内容包版本不可用")
        return self.pack

    def replace_documents(self, documents: dict) -> None:
        self.pack = replace(self.pack, documents=documents)


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
                "choose_route",
                "open_artifact",
                "enter_gallery",
                "move_next",
                "move_previous",
                "locate_artifact",
                "enter_story",
                "return_to_exhibit",
                "set_view",
                "browse_gallery",
                "seek_time_range",
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


def test_choose_route_command_selects_the_requested_node(tmp_path) -> None:
    database, state, _, token, service = make_service(tmp_path)
    payload = command(token)
    payload.update(
        {
            "action": "choose_route",
            "target_id": NODE_THREE,
        }
    )

    receipt = service.execute(state.session_id, ACTOR_ID, payload)

    assert receipt.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert (saved.node_id, saved.revision, saved.event_seq) == (NODE_THREE, 5, 1)


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
    params: dict | None = None,
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
    if params is not None:
        payload["params"] = params
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


def test_locate_from_story_returns_to_exhibit_and_moves_atomically(tmp_path) -> None:
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
            request_id="story-locate-enter-gallery",
        ),
    )
    started = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_story",
            target_id=STORY_ID,
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="story-locate-enter-story",
        ),
    )
    with database.transaction() as unit:
        started_state = unit.sessions.get(state.session_id)
    assert started_state is not None and started_state.exhibit_return_point is not None

    located = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.tang.artifact.ox",
            revision=started.revision,
            interaction_epoch=started.interaction_epoch,
            view_revision=started.view_revision,
            request_id="story-locate-ox",
        ),
    )

    assert located.status == "committed"
    assert located.revision == started.revision + 1
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
        events = unit.events.replay(state.session_id, after_seq=started_state.event_seq)
    assert saved is not None
    assert saved.mode == SessionMode.EXPLORE
    assert saved.story_id is None and saved.node_id is None
    assert saved.exhibit_return_point is None
    assert saved.station_id == "cn.tang.station.ox"
    assert saved.focused_entity_id == "cn.tang.artifact.ox"
    assert saved.revision == started.revision + 1
    assert saved.event_seq == started_state.event_seq + 1
    assert len(events) == 1
    assert events[0].entity_id == "cn.tang.artifact.ox"


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

    story = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_story",
            target_id=STORY_ID,
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="navigation-comparison-enter-story",
        ),
    )
    story_locate = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.tang.artifact.bowl",
            revision=story.revision,
            interaction_epoch=story.interaction_epoch,
            view_revision=story.view_revision,
            request_id="navigation-comparison-locate-from-story",
        ),
    )
    assert story_locate.status == "rejected"
    with database.transaction() as unit:
        story_saved = unit.sessions.get(state.session_id)
    assert story_saved is not None
    assert story_saved.mode == SessionMode.STORY
    assert story_saved.story_id == STORY_ID
    assert story_saved.exhibit_return_point is not None
    assert story_saved.revision == story.revision


def test_unreviewed_story_cannot_be_opened(tmp_path) -> None:
    database, state, tickets, token, _service = make_service(tmp_path)
    catalog = MemoryCatalog()
    documents = dict(catalog.pack.documents)
    documents["stories/observe.json"] = {
        **documents["stories/observe.json"],
        "review_status": "draft",
    }
    catalog.replace_documents(documents)
    service = CommandService(database.transaction, catalog, tickets)
    exploring = replace(
        state,
        mode=SessionMode.EXPLORE,
        story_id=None,
        node_id=None,
        revision=state.revision + 1,
    )
    with database.transaction() as unit:
        unit.sessions.save(exploring, expected_revision=state.revision)
    receipt = service.execute(
        state.session_id,
        ACTOR_ID,
        {
            "schema_version": "1",
            "request_id": "blocked-unreviewed-story",
            "expected_revision": exploring.revision,
            "interaction_epoch": exploring.interaction_epoch,
            "action": "enter_story",
            "target_id": STORY_ID,
            "control_ticket": token,
        },
    )
    assert receipt.status == "rejected"
    assert "尚未审核" in (receipt.reason or "")
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.mode == SessionMode.EXPLORE
    assert saved.story_id is None


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


def _eight_station_catalog(catalog: MemoryCatalog) -> None:
    documents = dict(catalog.pack.documents)
    gallery = dict(documents["galleries/tang.json"])
    stations = list(gallery["stations"])
    extras = [
        ("lute", 720, 740),
        ("flute", 750, 770),
        ("woman", 780, 800),
        ("follower", 810, 830),
        ("guardian", 850, 870),
    ]
    for index, (slug, start, end) in enumerate(extras, start=3):
        artifact_id = f"cn.tang.artifact.{slug}"
        documents[f"artifacts/{slug}.json"] = {"id": artifact_id}
        stations.append(
            {
                "id": f"cn.tang.station.{slug}",
                "order": index,
                "artifact_id": artifact_id,
                "time_range": {"start_year": start, "end_year": end, "precision": "range"},
            }
        )
    gallery["stations"] = stations
    documents["galleries/tang.json"] = gallery
    catalog.pack = PublishedPack(PACK_ID, VERSION, "1", documents)


def test_browse_gallery_moves_one_window_and_stays_in_overview(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    _eight_station_catalog(service._catalog)
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
            request_id="browse-enter",
        ),
    )
    moved = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="browse_gallery",
            params={"direction": "next"},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="browse-next",
        ),
    )
    assert moved.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.station_id == "cn.tang.station.flute"
    assert saved.gallery_view.window_start == 4
    assert saved.focused_entity_id == "cn.tang.artifact.flute"

    retry = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="browse_gallery",
            params={"direction": "next"},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="browse-next",
        ),
    )
    assert retry == moved

    boundary = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="browse_gallery",
            params={"direction": "next"},
            revision=moved.revision,
            interaction_epoch=moved.interaction_epoch,
            view_revision=moved.view_revision,
            request_id="browse-next-boundary",
        ),
    )
    assert boundary.status == "rejected"
    assert "最后一组" in (boundary.reason or "")
    with database.transaction() as unit:
        unchanged = unit.sessions.get(state.session_id)
    assert unchanged is not None
    assert unchanged.station_id == "cn.tang.station.flute"
    assert unchanged.revision == moved.revision


def test_seek_time_range_filters_closed_interval_and_zero_hits_keep_page(tmp_path) -> None:
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
            request_id="seek-enter",
        ),
    )
    century = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 701, "end_year": 800},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="seek-eighth-century",
        ),
    )
    assert century.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.focused_entity_id == "cn.tang.artifact.coin"
    assert saved.display_order == ("cn.tang.artifact.coin", "cn.tang.artifact.ox")
    assert saved.gallery_view.time_filter is not None
    assert saved.gallery_view.time_filter.start_year == 701
    assert saved.gallery_view.time_filter.end_year == 800

    empty = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 620, "end_year": 630},
            revision=century.revision,
            interaction_epoch=century.interaction_epoch,
            view_revision=century.view_revision,
            request_id="seek-empty",
        ),
    )
    assert empty.status == "rejected"
    assert "没有落在该年代范围" in (empty.reason or "")
    with database.transaction() as unit:
        unchanged = unit.sessions.get(state.session_id)
    assert unchanged is not None
    assert unchanged.revision == century.revision
    assert unchanged.display_order == ("cn.tang.artifact.coin", "cn.tang.artifact.ox")

    song = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 960, "end_year": 1127},
            revision=century.revision,
            interaction_epoch=century.interaction_epoch,
            view_revision=century.view_revision,
            request_id="seek-song",
        ),
    )
    assert song.status == "rejected"
    assert "尚未开放" in (song.reason or "")

    cleared = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"clear": True},
            revision=century.revision,
            interaction_epoch=century.interaction_epoch,
            view_revision=century.view_revision,
            request_id="seek-clear",
        ),
    )
    assert cleared.status == "committed"
    with database.transaction() as unit:
        restored = unit.sessions.get(state.session_id)
    assert restored is not None
    assert restored.gallery_view.time_filter is None
    assert restored.display_order == (
        "cn.tang.artifact.stele",
        "cn.tang.artifact.coin",
        "cn.tang.artifact.ox",
    )


def test_locate_outside_time_filter_clears_filter_in_one_transaction(tmp_path) -> None:
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
            request_id="locate-filter-enter",
        ),
    )
    filtered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 713, "end_year": 741},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="locate-filter-seek",
        ),
    )
    located = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.tang.artifact.stele",
            revision=filtered.revision,
            interaction_epoch=filtered.interaction_epoch,
            view_revision=filtered.view_revision,
            request_id="locate-filter-stele",
        ),
    )
    assert located.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.focused_entity_id == "cn.tang.artifact.stele"
    assert saved.gallery_view.time_filter is None
    assert saved.display_order[0] == "cn.tang.artifact.stele"


def test_enter_gallery_consumes_requested_page_size_and_keeps_tang_default(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    _eight_station_catalog(service._catalog)
    entered = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            params={"page_size": 3},
            revision=state.revision,
            interaction_epoch=state.interaction_epoch,
            view_revision=state.view_revision,
            request_id="enter-page-3",
        ),
    )
    assert entered.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.gallery_view.page_size == 3
    assert saved.gallery_view.window_start == 0
    assert saved.display_order[:3] == (
        "cn.tang.artifact.stele",
        "cn.tang.artifact.coin",
        "cn.tang.artifact.ox",
    )

    reloaded = CommandService(database.transaction, service._catalog, service._tickets)
    restored = reloaded.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="browse_gallery",
            params={"direction": "next"},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="enter-page-3-next",
        ),
    )
    assert restored.status == "committed"
    with database.transaction() as unit:
        paged = unit.sessions.get(state.session_id)
    assert paged is not None
    assert paged.gallery_view.page_size == 3
    assert paged.gallery_view.window_start == 3
    assert paged.station_id == "cn.tang.station.lute"

    same_size = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            params={"page_size": 3},
            revision=restored.revision,
            interaction_epoch=restored.interaction_epoch,
            view_revision=restored.view_revision,
            request_id="enter-page-3-repeat",
        ),
    )
    assert same_size.status == "rejected"
    assert "已在该展厅" in (same_size.reason or "")
    with database.transaction() as unit:
        unchanged = unit.sessions.get(state.session_id)
    assert unchanged is not None
    assert unchanged.revision == restored.revision
    assert unchanged.gallery_view.page_size == 3
    assert unchanged.station_id == "cn.tang.station.lute"

    resized = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.tang.gallery.main",
            params={"page_size": 4},
            revision=restored.revision,
            interaction_epoch=restored.interaction_epoch,
            view_revision=restored.view_revision,
            request_id="enter-page-4-resize",
        ),
    )
    assert resized.status == "committed"
    with database.transaction() as unit:
        four = unit.sessions.get(state.session_id)
    assert four is not None
    assert four.gallery_view.page_size == 4
    assert four.station_id == "cn.tang.station.lute"
    assert four.gallery_view.window_start == 0


def test_enter_gallery_rejects_invalid_page_size_without_changing_state(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    with pytest.raises(InvalidCommand, match="page_size"):
        service.execute(
            state.session_id,
            ACTOR_ID,
            _navigation_command(
                token,
                action="enter_gallery",
                target_id="cn.tang.gallery.main",
                params={"page_size": 5},
                revision=state.revision,
                interaction_epoch=state.interaction_epoch,
                view_revision=state.view_revision,
                request_id="enter-page-5",
            ),
        )
    with pytest.raises(InvalidCommand, match="page_size"):
        service.execute(
            state.session_id,
            ACTOR_ID,
            _navigation_command(
                token,
                action="enter_gallery",
                target_id="cn.tang.gallery.main",
                params={"page_size": 0},
                revision=state.revision,
                interaction_epoch=state.interaction_epoch,
                view_revision=state.view_revision,
                request_id="enter-page-0",
            ),
        )
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.revision == state.revision
    assert saved.gallery_id is None


def test_enter_gallery_without_page_size_keeps_tang_four(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    _eight_station_catalog(service._catalog)
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
            request_id="enter-default-4",
        ),
    )
    assert entered.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(state.session_id)
    assert saved is not None
    assert saved.gallery_view.page_size == 4
    moved = service.execute(
        state.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="browse_gallery",
            params={"direction": "next"},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="enter-default-4-next",
        ),
    )
    assert moved.status == "committed"
    with database.transaction() as unit:
        next_page = unit.sessions.get(state.session_id)
    assert next_page is not None
    assert next_page.gallery_view.page_size == 4
    assert next_page.gallery_view.window_start == 4


def _song_catalog(catalog: MemoryCatalog) -> None:
    documents = {
        "manifest.json": {
            "id": "cn.song.core",
            "version": "0.1.0",
            "publication_status": "published",
            "time_range": {"start_year": 960, "end_year": 1279, "precision": "range"},
        },
        "artifacts/ewer.json": {"id": "cn.song.artifact.qingbai-ewer"},
        "artifacts/house.json": {"id": "cn.song.artifact.qingbai-house"},
        "artifacts/tea.json": {"id": "cn.song.artifact.jian-tea-bowl"},
        "artifacts/poem.json": {"id": "cn.song.artifact.shuidiao-getou"},
        "galleries/song.json": {
            "id": "cn.song.gallery.main",
            "status": "open",
            "default_station_id": "cn.song.station.ewer",
            "stations": [
                {
                    "id": "cn.song.station.ewer",
                    "order": 0,
                    "artifact_id": "cn.song.artifact.qingbai-ewer",
                    "time_range": {"start_year": 1100, "end_year": 1200, "precision": "century"},
                },
                {
                    "id": "cn.song.station.house",
                    "order": 1,
                    "artifact_id": "cn.song.artifact.qingbai-house",
                    "time_range": {"start_year": 960, "end_year": 1127, "precision": "range"},
                },
                {
                    "id": "cn.song.station.tea",
                    "order": 2,
                    "artifact_id": "cn.song.artifact.jian-tea-bowl",
                    "time_range": {"start_year": 1100, "end_year": 1279, "precision": "range"},
                },
                {
                    "id": "cn.song.station.poem",
                    "order": 3,
                    "artifact_id": "cn.song.artifact.shuidiao-getou",
                    "time_range": {
                        "start_year": 960,
                        "end_year": 1279,
                        "precision": "unknown",
                        "display_label": "时间不详",
                    },
                },
            ],
        },
    }
    catalog.pack = PublishedPack("cn.song.core", "0.1.0", "1", documents)


def test_seek_time_range_uses_pinned_pack_era_and_skips_unknown_dates(tmp_path) -> None:
    database, state, token, service = _exploration_service(tmp_path)
    _song_catalog(service._catalog)
    exploring = replace(state, pack_versions={"cn.song.core": "0.1.0"}, revision=state.revision + 1)
    with database.transaction() as unit:
        unit.sessions.save(exploring, expected_revision=state.revision)
    entered = service.execute(
        exploring.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="enter_gallery",
            target_id="cn.song.gallery.main",
            params={"page_size": 3},
            revision=exploring.revision,
            interaction_epoch=exploring.interaction_epoch,
            view_revision=exploring.view_revision,
            request_id="song-enter",
        ),
    )
    assert entered.status == "committed"
    with database.transaction() as unit:
        saved = unit.sessions.get(exploring.session_id)
    assert saved is not None
    assert saved.gallery_view.page_size == 3
    assert saved.display_order == (
        "cn.song.artifact.qingbai-ewer",
        "cn.song.artifact.qingbai-house",
        "cn.song.artifact.jian-tea-bowl",
        "cn.song.artifact.shuidiao-getou",
    )

    year_1100 = service.execute(
        exploring.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 1100, "end_year": 1100},
            revision=entered.revision,
            interaction_epoch=entered.interaction_epoch,
            view_revision=entered.view_revision,
            request_id="song-seek-1100",
        ),
    )
    assert year_1100.status == "committed"
    with database.transaction() as unit:
        filtered = unit.sessions.get(exploring.session_id)
    assert filtered is not None
    assert "cn.song.artifact.shuidiao-getou" not in filtered.display_order
    assert filtered.display_order[0] == "cn.song.artifact.qingbai-ewer"

    tang_year = service.execute(
        exploring.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="seek_time_range",
            params={"start_year": 701, "end_year": 701},
            revision=year_1100.revision,
            interaction_epoch=year_1100.interaction_epoch,
            view_revision=year_1100.view_revision,
            request_id="song-seek-tang",
        ),
    )
    assert tang_year.status == "rejected"
    assert "尚未开放" in (tang_year.reason or "")
    assert "唐朝" not in (tang_year.reason or "")
    with database.transaction() as unit:
        unchanged = unit.sessions.get(exploring.session_id)
    assert unchanged is not None
    assert unchanged.revision == year_1100.revision

    located = service.execute(
        exploring.session_id,
        ACTOR_ID,
        _navigation_command(
            token,
            action="locate_artifact",
            target_id="cn.song.artifact.shuidiao-getou",
            revision=year_1100.revision,
            interaction_epoch=year_1100.interaction_epoch,
            view_revision=year_1100.view_revision,
            request_id="song-locate-unknown",
        ),
    )
    assert located.status == "committed"
    with database.transaction() as unit:
        revealed = unit.sessions.get(exploring.session_id)
    assert revealed is not None
    assert revealed.focused_entity_id == "cn.song.artifact.shuidiao-getou"
    assert revealed.gallery_view.time_filter is None
    assert revealed.gallery_view.page_size == 3
