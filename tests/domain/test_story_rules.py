import pytest
from museum.domain.session.models import SessionMode, SessionState
from museum.domain.story.conditions import (
    Condition,
    ConditionOp,
    InvalidStoryRule,
    evaluate_for_session,
)
from museum.domain.story.effects import Effect, EffectOp, apply_effects


def make_session() -> SessionState:
    return SessionState(
        session_id="sess_story_01",
        pack_versions={"cn.tang.core": "1.0.0"},
        mode=SessionMode.STORY,
        story_id="cn.tang.story.stele",
        node_id="cn.tang.node.stele.01",
        story_variables={"trust": 2, "asked_date": True},
        revision=4,
        event_seq=7,
        interaction_epoch=2,
    )


def test_conditions_support_nested_all_any_comparison_and_discoveries() -> None:
    state = make_session()
    rule = Condition(
        ConditionOp.ALL,
        items=(
            Condition(ConditionOp.GREATER_OR_EQUAL, path="trust", value=2),
            Condition(
                ConditionOp.ANY,
                items=(
                    Condition(ConditionOp.HAS_DISCOVERY, path="discoveries.date"),
                    Condition(ConditionOp.EQUALS, path="asked_date", value=True),
                ),
            ),
        ),
    )

    assert evaluate_for_session(rule, state)
    assert state.story_variables == {"trust": 2, "asked_date": True}
    assert state.revision == 4


def test_missing_variable_and_unseen_discovery_fail_closed() -> None:
    state = make_session()

    assert not evaluate_for_session(
        Condition(ConditionOp.EQUALS, path="missing", value=True), state
    )
    assert not evaluate_for_session(
        Condition(ConditionOp.HAS_DISCOVERY, path="discoveries.unknown"), state
    )


def test_effects_update_only_declared_variables_and_discoveries_immutably() -> None:
    state = make_session()

    updated = apply_effects(
        state,
        (
            Effect(EffectOp.SET, path="trust", value=3),
            Effect(EffectOp.ADD_DISCOVERY, path="discoveries.date"),
        ),
    )

    assert updated.story_variables["trust"] == 3
    assert "discoveries.date" in updated.discoveries
    assert state.story_variables["trust"] == 2
    assert state.discoveries == frozenset()
    assert updated.revision == state.revision
    assert updated.event_seq == state.event_seq


def test_rule_language_rejects_empty_combinators_and_nonnumeric_comparisons() -> None:
    with pytest.raises(InvalidStoryRule):
        Condition(ConditionOp.ALL)
    with pytest.raises(InvalidStoryRule):
        Condition(ConditionOp.GREATER_OR_EQUAL, path="trust", value=True)
