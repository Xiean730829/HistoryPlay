from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from museum.domain.story.conditions import Condition, ConditionOp, InvalidStoryRule
from museum.domain.story.effects import Effect, EffectOp
from museum.domain.story.models import (
    ExitAction,
    StoryAction,
    StoryDefinition,
    StoryExit,
    StoryNode,
)
from museum.ports.content_catalog import PublishedPack


class InvalidStoryContent(ValueError):
    """A pinned story cannot be safely interpreted by the story engine."""


DocumentFinder = Callable[[tuple[PublishedPack, ...], str, str], Mapping[str, Any]]


def load_story(
    packs: tuple[PublishedPack, ...],
    story_id: str,
    find_document: DocumentFinder,
) -> StoryDefinition:
    story = find_document(packs, story_id, "stories/")
    node_ids = story.get("node_ids")
    if not isinstance(node_ids, list) or not node_ids:
        raise InvalidStoryContent(f"故事没有节点清单：{story_id}")
    nodes: dict[str, StoryNode] = {}
    try:
        for node_id in node_ids:
            if not isinstance(node_id, str):
                raise InvalidStoryContent(f"故事节点标识无效：{story_id}")
            raw = find_document(packs, node_id, "nodes/")
            if raw.get("story_id") != story_id:
                raise InvalidStoryContent(f"节点不属于当前故事：{node_id}")
            exits = tuple(
                StoryExit(
                    action=ExitAction(exit_item["action"]),
                    target_node_id=exit_item["target_node_id"],
                    route_label=exit_item.get("route_label"),
                    when=_condition(exit_item.get("when")),
                )
                for exit_item in raw["exits"]
            )
            nodes[node_id] = StoryNode(
                id=node_id,
                story_id=story_id,
                allowed_actions=tuple(StoryAction(item) for item in raw["allowed_actions"]),
                exits=exits,
                enter_when=_condition(raw.get("enter_when")),
                effects=tuple(_effect(item) for item in raw.get("effects", [])),
            )
        return StoryDefinition(
            id=story_id,
            entry_node_id=story["entry_node_id"],
            nodes=nodes,
        )
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, InvalidStoryContent):
            raise
        raise InvalidStoryContent(f"发布故事结构无效：{story_id}") from error


def _condition(value: object) -> Condition | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise InvalidStoryRule("故事条件必须是对象")
    try:
        op = ConditionOp(value["op"])
        items = tuple(_condition(item) for item in value.get("items", []))
        return Condition(
            op=op,
            path=value.get("path"),
            value=value.get("value"),
            items=tuple(item for item in items if item is not None),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidStoryRule("发布故事包含无法解释的条件") from error


def _effect(value: object) -> Effect:
    if not isinstance(value, Mapping):
        raise InvalidStoryRule("故事效果必须是对象")
    try:
        return Effect(op=EffectOp(value["op"]), path=value["path"], value=value.get("value"))
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidStoryRule("发布故事包含无法解释的效果") from error
