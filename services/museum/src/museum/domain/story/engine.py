from __future__ import annotations

from dataclasses import replace

from museum.domain.session.events import SessionEvent, SessionEventKind
from museum.domain.session.models import ExhibitReturnPoint, SessionMode, SessionState
from museum.domain.story.conditions import evaluate_for_session
from museum.domain.story.effects import apply_effects
from museum.domain.story.models import (
    ExitAction,
    StoryAction,
    StoryDefinition,
    StoryExit,
    StoryTransition,
)


class InvalidStoryAction(ValueError):
    """Raised when the current story state cannot perform the requested action."""


def start_story(state: SessionState, story: StoryDefinition) -> StoryTransition:
    if state.mode == SessionMode.QA:
        raise InvalidStoryAction("问答模式必须先返回原主线")
    entry = story.nodes[story.entry_node_id]
    return_point = state.exhibit_return_point
    if (
        state.mode == SessionMode.EXPLORE
        and return_point is None
        and state.gallery_id is not None
        and state.station_id is not None
    ):
        return_point = ExhibitReturnPoint(
            gallery_id=state.gallery_id,
            station_id=state.station_id,
            focused_entity_id=state.focused_entity_id,
            view=state.camera_pose,
            view_revision=state.view_revision,
        )
    started = replace(
        state,
        mode=SessionMode.STORY,
        story_id=story.id,
        node_id=entry.id,
        story_variables={},
        exhibit_return_point=return_point,
    )
    if not evaluate_for_session(entry.enter_when, started):
        raise InvalidStoryAction("故事入口条件尚未满足")
    started = _commit(apply_effects(started, entry.effects))
    return StoryTransition(
        state=started,
        event=_event(started, SessionEventKind.STORY_ENTERED),
        available_exits=available_exits(started, story),
    )


def available_exits(state: SessionState, story: StoryDefinition) -> tuple[StoryExit, ...]:
    current = _current_node(state, story)
    if StoryAction.CONTINUE_STORY not in current.allowed_actions and StoryAction.CHOOSE_ROUTE not in current.allowed_actions:
        return ()
    exits: list[StoryExit] = []
    for exit in current.exits:
        if exit.action.value not in {action.value for action in current.allowed_actions}:
            continue
        if not evaluate_for_session(exit.when, state):
            continue
        target = story.nodes[exit.target_node_id]
        if evaluate_for_session(target.enter_when, state):
            exits.append(exit)
    return tuple(exits)


def advance_story(
    state: SessionState,
    story: StoryDefinition,
    action: ExitAction,
    *,
    target_node_id: str | None = None,
) -> StoryTransition:
    current = _current_node(state, story)
    if action == ExitAction.RETURN_TO_EXHIBIT:
        raise InvalidStoryAction("返回展台必须使用会话返回命令")
    if StoryAction(action.value) not in current.allowed_actions:
        raise InvalidStoryAction(f"当前节点不允许动作：{action.value}")
    if target_node_id is not None and action != ExitAction.CHOOSE_ROUTE:
        raise InvalidStoryAction("只有选路动作可以指定目标节点")
    candidates = tuple(
        exit
        for exit in available_exits(state, story)
        if exit.action == action
        and (target_node_id is None or exit.target_node_id == target_node_id)
    )
    targets = {exit.target_node_id for exit in candidates}
    if not candidates:
        raise InvalidStoryAction("当前状态下没有符合条件的故事出口")
    if len(targets) > 1:
        if target_node_id is None:
            raise InvalidStoryAction("有多个可选故事走向，必须明确指定目标节点")
        raise InvalidStoryAction("选定的故事走向仍有多个可用出口")

    target_id = targets.pop()
    target = story.nodes[target_id]
    advanced = replace(state, node_id=target_id)
    advanced = _commit(apply_effects(advanced, target.effects))
    return StoryTransition(
        state=advanced,
        event=_event(advanced, SessionEventKind.STORY_ADVANCED),
        available_exits=available_exits(advanced, story),
    )


def _current_node(state: SessionState, story: StoryDefinition):
    if state.mode != SessionMode.STORY or state.story_id != story.id or state.node_id not in story.nodes:
        raise InvalidStoryAction("会话没有位于该故事的有效节点")
    return story.nodes[state.node_id]


def _commit(state: SessionState) -> SessionState:
    return replace(
        state,
        revision=state.revision + 1,
        event_seq=state.event_seq + 1,
        interaction_epoch=state.interaction_epoch + 1,
    )


def _event(state: SessionState, kind: SessionEventKind) -> SessionEvent:
    return SessionEvent(
        session_id=state.session_id,
        event_seq=state.event_seq,
        kind=kind,
        revision=state.revision,
        interaction_epoch=state.interaction_epoch,
        story_id=state.story_id,
        node_id=state.node_id,
    )
