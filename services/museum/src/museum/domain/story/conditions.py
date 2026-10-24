from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from museum.domain.session.models import SessionState

RuleValue = bool | int | float | str


class ConditionOp(StrEnum):
    ALL = "all"
    ANY = "any"
    EQUALS = "equals"
    GREATER_OR_EQUAL = "greater_or_equal"
    HAS_DISCOVERY = "has_discovery"


class InvalidStoryRule(ValueError):
    """Raised when a story rule is malformed or uses an unsupported operation."""


@dataclass(frozen=True, slots=True)
class Condition:
    op: ConditionOp
    path: str | None = None
    value: RuleValue | None = None
    items: tuple[Condition, ...] = ()

    def __post_init__(self) -> None:
        if self.op in {ConditionOp.ALL, ConditionOp.ANY}:
            if not self.items:
                raise InvalidStoryRule(f"{self.op.value} 条件必须包含子条件")
            if self.path is not None or self.value is not None:
                raise InvalidStoryRule(f"{self.op.value} 条件不能包含 path 或 value")
            return
        if not self.path:
            raise InvalidStoryRule(f"{self.op.value} 条件必须声明 path")
        if self.items:
            raise InvalidStoryRule(f"{self.op.value} 条件不能包含子条件")
        if self.op == ConditionOp.HAS_DISCOVERY:
            if self.value is not None:
                raise InvalidStoryRule("has_discovery 只使用 path 指定发现项")
        elif self.value is None:
            raise InvalidStoryRule(f"{self.op.value} 条件必须声明 value")
        if self.op == ConditionOp.GREATER_OR_EQUAL and (
            isinstance(self.value, bool) or not isinstance(self.value, (int, float))
        ):
            raise InvalidStoryRule("greater_or_equal 的 value 必须是数字")


def evaluate_condition(
    condition: Condition | None,
    *,
    story_variables: Mapping[str, RuleValue],
    discoveries: frozenset[str] | set[str],
) -> bool:
    """Evaluate the small declarative rule language without evaluating code."""
    if condition is None:
        return True
    if condition.op == ConditionOp.ALL:
        return all(
            evaluate_condition(item, story_variables=story_variables, discoveries=discoveries)
            for item in condition.items
        )
    if condition.op == ConditionOp.ANY:
        return any(
            evaluate_condition(item, story_variables=story_variables, discoveries=discoveries)
            for item in condition.items
        )
    if condition.op == ConditionOp.HAS_DISCOVERY:
        return condition.path in discoveries

    current = story_variables.get(condition.path or "")
    if condition.op == ConditionOp.EQUALS:
        return current == condition.value
    if condition.op == ConditionOp.GREATER_OR_EQUAL:
        return (
            isinstance(current, (int, float))
            and not isinstance(current, bool)
            and current >= condition.value  # type: ignore[operator]
        )
    raise InvalidStoryRule(f"不支持的条件操作：{condition.op}")


def evaluate_for_session(condition: Condition | None, state: SessionState) -> bool:
    return evaluate_condition(
        condition,
        story_variables=state.story_variables,
        discoveries=state.discoveries,
    )
