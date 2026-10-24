from __future__ import annotations

from dataclasses import replace

from museum.domain.session.events import SessionEvent, SessionEventKind, TransitionResult
from museum.domain.session.models import (
    CameraPose,
    ExhibitReturnPoint,
    ReturnPoint,
    SessionMode,
    SessionState,
)


class InvalidTransition(ValueError):
    """Raised when a requested session change is not valid in its current state."""


def focus_entity(state: SessionState, entity_id: str) -> TransitionResult:
    if entity_id not in state.visible_entities:
        raise InvalidTransition("只能聚焦当前可见展品")
    if state.focused_entity_id == entity_id:
        raise InvalidTransition("目标展品已经处于焦点")
    updated = _advance(state, focused_entity_id=entity_id)
    return _result(updated, SessionEventKind.FOCUS_CHANGED, entity_id=entity_id)


def enter_story(state: SessionState, story_id: str, node_id: str) -> TransitionResult:
    if not story_id or not node_id:
        raise InvalidTransition("进入故事需要故事和节点标识")
    updated = _advance(
        state,
        mode=SessionMode.STORY,
        story_id=story_id,
        node_id=node_id,
        story_variables={},
        narration_checkpoint=None,
    )
    return _result(updated, SessionEventKind.STORY_ENTERED, story_id=story_id, node_id=node_id)


def enter_qa(state: SessionState) -> TransitionResult:
    if state.mode != SessionMode.STORY or not state.story_id or not state.node_id:
        raise InvalidTransition("只有主线故事播放中可以进入问答")
    point = ReturnPoint(
        story_id=state.story_id,
        node_id=state.node_id,
        revision=state.revision,
        story_variables=state.story_variables,
        narration_checkpoint=state.narration_checkpoint,
    )
    updated = _advance(state, mode=SessionMode.QA, return_stack=(*state.return_stack, point))
    return _result(updated, SessionEventKind.QA_ENTERED, story_id=state.story_id, node_id=state.node_id)


def return_to_story(state: SessionState) -> TransitionResult:
    if state.mode != SessionMode.QA or not state.return_stack:
        raise InvalidTransition("当前没有可恢复的问答返回点")
    point = state.return_stack[-1]
    updated = _advance(
        state,
        mode=SessionMode.STORY,
        story_id=point.story_id,
        node_id=point.node_id,
        story_variables=point.story_variables,
        narration_checkpoint=point.narration_checkpoint,
        return_stack=state.return_stack[:-1],
    )
    return _result(
        updated,
        SessionEventKind.RETURNED_TO_STORY,
        story_id=point.story_id,
        node_id=point.node_id,
    )


def set_view(state: SessionState, view: CameraPose) -> TransitionResult:
    if state.mode != SessionMode.EXPLORE:
        raise InvalidTransition("只有长廊探索模式可以调整文物视角")
    if state.camera_pose == view:
        raise InvalidTransition("文物已经处于目标视角")
    updated = replace(
        state,
        camera_pose=view,
        revision=state.revision + 1,
        view_revision=state.view_revision + 1,
        event_seq=state.event_seq + 1,
        interaction_epoch=state.interaction_epoch + 1,
    )
    return _result(updated, SessionEventKind.VIEW_CHANGED, entity_id=state.focused_entity_id)


def return_to_exhibit(state: SessionState) -> TransitionResult:
    point = state.exhibit_return_point
    if state.mode not in {SessionMode.STORY, SessionMode.QA, SessionMode.HYPOTHESIS}:
        raise InvalidTransition("当前故事没有可恢复的展台返回点")
    if point is None:
        if state.gallery_id is None or state.station_id is None:
            raise InvalidTransition("当前故事没有可恢复的展台返回点")
        # Older saves predate the explicit root anchor but kept the explore
        # location and camera on the session snapshot itself.
        point = ExhibitReturnPoint(
            gallery_id=state.gallery_id,
            station_id=state.station_id,
            focused_entity_id=state.focused_entity_id,
            view=state.camera_pose,
            view_revision=state.view_revision,
        )
    updated = replace(
        state,
        mode=SessionMode.EXPLORE,
        story_id=None,
        node_id=None,
        story_variables={},
        return_stack=(),
        narration_checkpoint=None,
        gallery_id=point.gallery_id,
        station_id=point.station_id,
        current_location_id=point.station_id,
        focused_entity_id=point.focused_entity_id,
        camera_pose=point.view,
        exhibit_return_point=None,
        revision=state.revision + 1,
        view_revision=state.view_revision + 1,
        event_seq=state.event_seq + 1,
        interaction_epoch=state.interaction_epoch + 1,
    )
    return _result(updated, SessionEventKind.RETURNED_TO_EXHIBIT)


def _advance(state: SessionState, **changes: object) -> SessionState:
    return replace(
        state,
        **changes,
        revision=state.revision + 1,
        event_seq=state.event_seq + 1,
        interaction_epoch=state.interaction_epoch + 1,
    )


def _result(
    state: SessionState,
    kind: SessionEventKind,
    *,
    entity_id: str | None = None,
    story_id: str | None = None,
    node_id: str | None = None,
) -> TransitionResult:
    event = SessionEvent(
        session_id=state.session_id,
        event_seq=state.event_seq,
        kind=kind,
        revision=state.revision,
        interaction_epoch=state.interaction_epoch,
        entity_id=entity_id,
        story_id=story_id,
        node_id=node_id,
    )
    return TransitionResult(state=state, event=event)
