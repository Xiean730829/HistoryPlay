from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType

from museum.domain.session.events import SessionEvent
from museum.domain.session.models import SessionState
from museum.domain.story.conditions import Condition
from museum.domain.story.effects import Effect


class StoryAction(StrEnum):
    OBSERVE = "observe"
    ASK = "ask"
    SWITCH_PERSPECTIVE = "switch_perspective"
    CHOOSE_ROUTE = "choose_route"
    COMPARE_EVIDENCE = "compare_evidence"
    ENTER_HYPOTHESIS = "enter_hypothesis"
    CONTINUE_STORY = "continue_story"
    RETURN_TO_EXHIBIT = "return_to_exhibit"


class ExitAction(StrEnum):
    CONTINUE_STORY = "continue_story"
    CHOOSE_ROUTE = "choose_route"
    RETURN_TO_EXHIBIT = "return_to_exhibit"


@dataclass(frozen=True, slots=True)
class StoryExit:
    action: ExitAction
    target_node_id: str
    when: Condition | None = None

    def __post_init__(self) -> None:
        if not self.target_node_id:
            raise ValueError("故事出口必须指定目标节点")


@dataclass(frozen=True, slots=True)
class StoryNode:
    id: str
    story_id: str
    allowed_actions: tuple[StoryAction, ...]
    exits: tuple[StoryExit, ...]
    enter_when: Condition | None = None
    effects: tuple[Effect, ...] = ()

    def __post_init__(self) -> None:
        if not self.id or not self.story_id:
            raise ValueError("故事节点必须有稳定ID")
        allowed_actions = tuple(self.allowed_actions)
        exits = tuple(self.exits)
        effects = tuple(self.effects)
        if not allowed_actions or not exits:
            raise ValueError("故事节点必须声明动作和出口")
        if len(set(allowed_actions)) != len(allowed_actions):
            raise ValueError("故事节点不能重复声明动作")
        object.__setattr__(self, "allowed_actions", allowed_actions)
        object.__setattr__(self, "exits", exits)
        object.__setattr__(self, "effects", effects)


@dataclass(frozen=True, slots=True)
class StoryDefinition:
    id: str
    entry_node_id: str
    nodes: Mapping[str, StoryNode]

    def __post_init__(self) -> None:
        nodes = dict(self.nodes)
        if not self.id or self.entry_node_id not in nodes:
            raise ValueError("故事必须包含有效的入口节点")
        if any(key != node.id or node.story_id != self.id for key, node in nodes.items()):
            raise ValueError("节点索引、节点ID和所属故事必须一致")
        missing = {
            exit.target_node_id
            for node in nodes.values()
            for exit in node.exits
            if exit.target_node_id not in nodes
        }
        if missing:
            raise ValueError(f"故事出口指向不存在的节点：{', '.join(sorted(missing))}")
        object.__setattr__(self, "nodes", MappingProxyType(nodes))


@dataclass(frozen=True, slots=True)
class StoryTransition:
    state: SessionState
    event: SessionEvent
    available_exits: tuple[StoryExit, ...] = field(default_factory=tuple)
