from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from museum.domain.session.models import SessionState
from museum.domain.story.conditions import InvalidStoryRule, RuleValue


class EffectOp(StrEnum):
    SET = "set"
    ADD_DISCOVERY = "add_discovery"


@dataclass(frozen=True, slots=True)
class Effect:
    op: EffectOp
    path: str
    value: RuleValue | None = None

    def __post_init__(self) -> None:
        if not self.path:
            raise InvalidStoryRule(f"{self.op.value} 效果必须声明 path")
        if self.op == EffectOp.SET and self.value is None:
            raise InvalidStoryRule("set 效果必须声明 value")
        if self.op == EffectOp.ADD_DISCOVERY and self.value is not None:
            raise InvalidStoryRule("add_discovery 只使用 path 指定发现项")


def apply_effects(state: SessionState, effects: tuple[Effect, ...]) -> SessionState:
    """Apply only the schema-declared state effects; caller owns revision/event commits."""
    variables = dict(state.story_variables)
    discoveries = set(state.discoveries)
    for effect in effects:
        if effect.op == EffectOp.SET:
            variables[effect.path] = effect.value  # type: ignore[assignment]
        elif effect.op == EffectOp.ADD_DISCOVERY:
            discoveries.add(effect.path)
        else:
            raise InvalidStoryRule(f"不支持的效果操作：{effect.op}")
    return replace(state, story_variables=variables, discoveries=frozenset(discoveries))
