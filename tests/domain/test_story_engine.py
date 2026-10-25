from dataclasses import replace

import pytest
from museum.domain.session.models import SessionMode, SessionState
from museum.domain.story.conditions import Condition, ConditionOp
from museum.domain.story.effects import Effect, EffectOp
from museum.domain.story.engine import (
    InvalidStoryAction,
    advance_story,
    available_exits,
    start_story,
)
from museum.domain.story.models import (
    ExitAction,
    StoryAction,
    StoryDefinition,
    StoryExit,
    StoryNode,
)

STORY_ID = "cn.tang.story.observation"
NODE_ONE = "cn.tang.node.observation.01"
NODE_TWO = "cn.tang.node.observation.02"
NODE_THREE = "cn.tang.node.observation.03"


def make_session() -> SessionState:
    return SessionState(
        session_id="sess_story_02",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.EXPLORE,
        focused_entity_id="cn.tang.artifact.stele",
        visible_entities=("cn.tang.artifact.stele",),
        revision=3,
        event_seq=5,
        interaction_epoch=2,
    )


def make_story(*, ambiguous: bool = False) -> StoryDefinition:
    route_exits = [
        StoryExit(
            ExitAction.CHOOSE_ROUTE,
            NODE_TWO,
            Condition(ConditionOp.EQUALS, path="trust", value=1),
        ),
        StoryExit(
            ExitAction.CHOOSE_ROUTE,
            NODE_THREE,
            Condition(ConditionOp.EQUALS, path="trust", value=1 if ambiguous else 2),
        ),
    ]
    return StoryDefinition(
        id=STORY_ID,
        entry_node_id=NODE_ONE,
        nodes={
            NODE_ONE: StoryNode(
                id=NODE_ONE,
                story_id=STORY_ID,
                allowed_actions=(StoryAction.CONTINUE_STORY, StoryAction.CHOOSE_ROUTE),
                exits=(
                    StoryExit(ExitAction.CONTINUE_STORY, NODE_TWO),
                    *route_exits,
                ),
                effects=(Effect(EffectOp.SET, path="trust", value=1),),
            ),
            NODE_TWO: StoryNode(
                id=NODE_TWO,
                story_id=STORY_ID,
                allowed_actions=(StoryAction.CONTINUE_STORY,),
                exits=(StoryExit(ExitAction.CONTINUE_STORY, NODE_THREE),),
                enter_when=Condition(ConditionOp.GREATER_OR_EQUAL, path="trust", value=1),
                effects=(Effect(EffectOp.ADD_DISCOVERY, path="discoveries.stele_dated"),),
            ),
            NODE_THREE: StoryNode(
                id=NODE_THREE,
                story_id=STORY_ID,
                allowed_actions=(StoryAction.CONTINUE_STORY,),
                exits=(StoryExit(ExitAction.CONTINUE_STORY, NODE_THREE),),
            ),
        },
    )


def test_start_applies_entry_effects_and_returns_only_valid_exits() -> None:
    original = make_session()

    started = start_story(original, make_story())

    assert started.state.mode == SessionMode.STORY
    assert started.state.story_id == STORY_ID
    assert started.state.node_id == NODE_ONE
    assert started.state.story_variables == {"trust": 1}
    assert started.state.revision == 4
    assert started.event.event_seq == 6
    assert len(started.available_exits) == 2
    assert original.mode == SessionMode.EXPLORE
    assert original.story_id is None


def test_advance_checks_action_and_merges_branches_without_order_bias() -> None:
    story = make_story(ambiguous=True)
    started = start_story(make_session(), story)

    with pytest.raises(InvalidStoryAction, match="必须明确指定目标节点"):
        advance_story(started.state, story, ExitAction.CHOOSE_ROUTE)

    story = make_story()
    started = start_story(make_session(), story)
    advanced = advance_story(started.state, story, ExitAction.CHOOSE_ROUTE)
    assert advanced.state.node_id == NODE_TWO
    assert "discoveries.stele_dated" in advanced.state.discoveries
    assert advanced.state.revision == started.state.revision + 1
    assert advanced.event.kind.value == "story_advanced"


def test_choose_route_requires_and_honors_an_explicit_eligible_target() -> None:
    story = make_story(ambiguous=True)
    started = start_story(make_session(), story)

    with pytest.raises(InvalidStoryAction, match="指定目标节点"):
        advance_story(started.state, story, ExitAction.CHOOSE_ROUTE)

    selected = advance_story(
        started.state,
        story,
        ExitAction.CHOOSE_ROUTE,
        target_node_id=NODE_THREE,
    )
    assert selected.state.node_id == NODE_THREE
    assert selected.state.revision == started.state.revision + 1

    with pytest.raises(InvalidStoryAction, match="没有符合条件"):
        advance_story(
            started.state,
            story,
            ExitAction.CHOOSE_ROUTE,
            target_node_id="cn.tang.node.observation.missing",
        )
    assert started.state.node_id == NODE_ONE


def test_ineligible_target_and_disallowed_action_do_not_change_state() -> None:
    story = make_story()
    started = start_story(make_session(), story)
    altered = replace(started.state, story_variables={"trust": 0})

    assert all(exit.target_node_id != NODE_TWO for exit in available_exits(altered, story))
    with pytest.raises(InvalidStoryAction):
        advance_story(altered, story, ExitAction.CONTINUE_STORY)
    restricted_node = replace(
        story.nodes[NODE_ONE],
        allowed_actions=(StoryAction.CONTINUE_STORY,),
    )
    restricted_story = replace(story, nodes={**story.nodes, NODE_ONE: restricted_node})
    with pytest.raises(InvalidStoryAction, match="不允许"):
        advance_story(started.state, restricted_story, ExitAction.CHOOSE_ROUTE)
    assert altered.node_id == NODE_ONE
    assert altered.revision == started.state.revision


def test_story_definition_rejects_missing_targets() -> None:
    node = StoryNode(
        id=NODE_ONE,
        story_id=STORY_ID,
        allowed_actions=(StoryAction.CONTINUE_STORY,),
        exits=(StoryExit(ExitAction.CONTINUE_STORY, "cn.tang.node.missing"),),
    )

    with pytest.raises(ValueError, match="不存在"):
        StoryDefinition(id=STORY_ID, entry_node_id=NODE_ONE, nodes={NODE_ONE: node})
