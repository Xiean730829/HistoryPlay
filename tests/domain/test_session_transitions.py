from dataclasses import FrozenInstanceError

import pytest
from museum.domain.session.models import (
    CameraPose,
    ExhibitReturnPoint,
    NarrationCheckpoint,
    SessionMode,
    SessionState,
)
from museum.domain.session.transitions import (
    InvalidTransition,
    enter_qa,
    enter_story,
    focus_entity,
    return_to_exhibit,
    return_to_story,
    set_view,
)


def make_session() -> SessionState:
    return SessionState(
        session_id="sess_stele_001",
        pack_versions={"cn.tang.core": "1.0.0"},
        focused_entity_id="cn.tang.artifact.stele",
        visible_entities=("cn.tang.artifact.stele", "cn.tang.artifact.bowl"),
        display_order=("cn.tang.artifact.stele", "cn.tang.artifact.bowl"),
        mode=SessionMode.STORY,
        story_id="cn.tang.story.stele-observation",
        node_id="cn.tang.node.stele-observation.01",
        story_variables={"asked_date": True},
        revision=3,
        event_seq=5,
        interaction_epoch=2,
        narration_checkpoint=NarrationCheckpoint(
            last_started_node_id="cn.tang.node.stele-observation.01"
        ),
    )


def test_focus_changes_only_focus_and_emits_ordered_event() -> None:
    original = make_session()

    result = focus_entity(original, "cn.tang.artifact.bowl")

    assert result.state.focused_entity_id == "cn.tang.artifact.bowl"
    assert result.state.display_order == original.display_order
    assert result.state.revision == 4
    assert result.state.event_seq == 6
    assert result.state.interaction_epoch == 3
    assert result.event.entity_id == "cn.tang.artifact.bowl"
    assert original.focused_entity_id == "cn.tang.artifact.stele"
    with pytest.raises(FrozenInstanceError):
        original.revision = 9  # type: ignore[misc]


def test_qa_round_trip_restores_story_node_variables_and_narration_checkpoint() -> None:
    original = make_session()

    qa = enter_qa(original)
    returned = return_to_story(qa.state)

    assert qa.state.mode == SessionMode.QA
    assert qa.state.return_stack[-1].node_id == original.node_id
    assert returned.state.mode == SessionMode.STORY
    assert returned.state.story_id == original.story_id
    assert returned.state.node_id == original.node_id
    assert returned.state.story_variables == original.story_variables
    assert returned.state.narration_checkpoint == original.narration_checkpoint
    assert returned.state.return_stack == ()
    assert returned.state.revision == original.revision + 2
    assert returned.event.event_seq == original.event_seq + 2
    assert original.mode == SessionMode.STORY
    assert original.return_stack == ()


def test_entering_new_story_does_not_mutate_previous_session() -> None:
    original = make_session()

    result = enter_story(original, "cn.tang.story.other", "cn.tang.node.other.01")

    assert result.state.story_id == "cn.tang.story.other"
    assert result.state.node_id == "cn.tang.node.other.01"
    assert result.state.revision == original.revision + 1
    assert original.story_id == "cn.tang.story.stele-observation"


def test_queries_or_invalid_changes_cannot_advance_story_state() -> None:
    original = make_session()

    with pytest.raises(InvalidTransition):
        focus_entity(original, "cn.tang.artifact.hidden")
    with pytest.raises(InvalidTransition):
        return_to_story(original)

    assert original.node_id == "cn.tang.node.stele-observation.01"
    assert original.revision == 3
    assert original.event_seq == 5


def test_story_exhibit_return_anchor_is_separate_from_qa_return_stack() -> None:
    story_state = SessionState(
        session_id="sess_corridor_01",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.STORY,
        gallery_id="cn.tang.gallery.main",
        station_id="cn.tang.station.ox",
        current_location_id="cn.tang.station.ox",
        story_id="cn.tang.story.ox",
        node_id="cn.tang.node.ox.01",
        return_stack=(),
        focused_entity_id="cn.tang.artifact.ox",
        visible_entities=("cn.tang.artifact.ox",),
        display_order=("cn.tang.artifact.ox",),
        camera_pose=CameraPose(yaw=32, pitch=-8, zoom=1.7),
        view_revision=4,
        exhibit_return_point=ExhibitReturnPoint(
            gallery_id="cn.tang.gallery.main",
            station_id="cn.tang.station.ox",
            focused_entity_id="cn.tang.artifact.ox",
            view=CameraPose(yaw=32, pitch=-8, zoom=1.7),
            view_revision=4,
        ),
    )

    qa = enter_qa(story_state)
    resumed = return_to_story(qa.state)
    returned = return_to_exhibit(resumed.state)

    assert qa.state.exhibit_return_point == story_state.exhibit_return_point
    assert qa.state.return_stack[-1].story_id == story_state.story_id
    assert returned.state.mode == SessionMode.EXPLORE
    assert returned.state.gallery_id == "cn.tang.gallery.main"
    assert returned.state.station_id == returned.state.current_location_id == "cn.tang.station.ox"
    assert returned.state.focused_entity_id == "cn.tang.artifact.ox"
    assert returned.state.camera_pose == CameraPose(yaw=32, pitch=-8, zoom=1.7)
    assert returned.state.exhibit_return_point is None
    assert returned.event.kind.value == "returned_to_exhibit"


def test_legacy_story_without_root_anchor_returns_to_saved_exhibit_and_view() -> None:
    legacy_story = SessionState(
        session_id="sess_legacy_story_01",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.STORY,
        gallery_id="cn.tang.gallery.main",
        station_id="cn.tang.station.ox",
        current_location_id="cn.tang.station.ox",
        story_id="cn.tang.story.ox",
        node_id="cn.tang.node.ox.01",
        focused_entity_id="cn.tang.artifact.ox",
        visible_entities=("cn.tang.artifact.ox",),
        display_order=("cn.tang.artifact.ox",),
        camera_pose=CameraPose(yaw=32, pitch=-8, zoom=1.7),
        revision=8,
        view_revision=4,
        event_seq=7,
        interaction_epoch=6,
    )

    returned = return_to_exhibit(legacy_story)

    assert returned.state.mode == SessionMode.EXPLORE
    assert returned.state.gallery_id == "cn.tang.gallery.main"
    assert returned.state.station_id == returned.state.current_location_id == "cn.tang.station.ox"
    assert returned.state.focused_entity_id == "cn.tang.artifact.ox"
    assert returned.state.camera_pose == CameraPose(yaw=32, pitch=-8, zoom=1.7)
    assert returned.state.exhibit_return_point is None
    assert returned.state.revision == 9
    assert returned.state.event_seq == 8
    assert returned.state.interaction_epoch == 7
    with pytest.raises(InvalidTransition, match="没有可恢复的展台返回点"):
        return_to_exhibit(make_session())


def test_view_change_is_revisioned_and_explore_only() -> None:
    explored = SessionState(
        session_id="sess_view_0001",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.EXPLORE,
        gallery_id="cn.tang.gallery.main",
        station_id="cn.tang.station.ox",
    )
    changed = set_view(explored, CameraPose(yaw=15, pitch=5, zoom=2))
    assert changed.state.camera_pose == CameraPose(yaw=15, pitch=5, zoom=2)
    assert changed.state.revision == explored.revision + 1
    assert changed.state.view_revision == explored.view_revision + 1
    with pytest.raises(InvalidTransition, match="探索模式"):
        set_view(make_session(), CameraPose(yaw=15, pitch=5, zoom=2))
