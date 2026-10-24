from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType


class SessionMode(StrEnum):
    EXPLORE = "explore"
    STORY = "story"
    QA = "qa"
    HYPOTHESIS = "hypothesis"


@dataclass(frozen=True, slots=True)
class HistoricalTime:
    start_year: int
    end_year: int
    precision: str
    display_label: str | None = None

    def __post_init__(self) -> None:
        if self.start_year > self.end_year:
            raise ValueError("历史时间范围的起始年份不能晚于结束年份")
        if self.precision not in {"year", "decade", "century", "range", "unknown"}:
            raise ValueError("不支持的历史时间精度")


@dataclass(frozen=True, slots=True)
class NarrationCheckpoint:
    last_started_node_id: str | None = None
    last_completed_node_id: str | None = None


@dataclass(frozen=True, slots=True)
class ReturnPoint:
    story_id: str
    node_id: str
    revision: int
    story_variables: Mapping[str, bool | int | float | str] = field(default_factory=dict)
    narration_checkpoint: NarrationCheckpoint | None = None

    def __post_init__(self) -> None:
        if not self.story_id or not self.node_id:
            raise ValueError("返回点必须包含故事和节点")
        if self.revision < 0:
            raise ValueError("返回点修订号不能为负数")
        object.__setattr__(self, "story_variables", _freeze_variables(self.story_variables))


@dataclass(frozen=True, slots=True)
class SessionState:
    session_id: str
    pack_versions: Mapping[str, str]
    mode: SessionMode = SessionMode.EXPLORE
    world_time: HistoricalTime | None = None
    current_location_id: str | None = None
    focused_entity_id: str | None = None
    visible_entities: tuple[str, ...] = ()
    display_order: tuple[str, ...] = ()
    story_id: str | None = None
    node_id: str | None = None
    story_variables: Mapping[str, bool | int | float | str] = field(default_factory=dict)
    return_stack: tuple[ReturnPoint, ...] = ()
    revision: int = 0
    view_revision: int = 0
    event_seq: int = 0
    interaction_epoch: int = 0
    discoveries: frozenset[str] = frozenset()
    narration_checkpoint: NarrationCheckpoint | None = None

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("会话ID不能为空")
        if not self.pack_versions:
            raise ValueError("会话必须固定至少一个内容包版本")
        if min(self.revision, self.view_revision, self.event_seq, self.interaction_epoch) < 0:
            raise ValueError("会话序号不能为负数")
        if self.mode == SessionMode.STORY and (not self.story_id or not self.node_id):
            raise ValueError("故事模式必须包含故事和节点")
        if self.mode == SessionMode.QA and not self.return_stack:
            raise ValueError("问答模式必须保留主线返回点")
        if self.focused_entity_id and self.visible_entities and self.focused_entity_id not in self.visible_entities:
            raise ValueError("焦点展品必须是当前可见展品")
        object.__setattr__(self, "pack_versions", MappingProxyType(dict(self.pack_versions)))
        object.__setattr__(self, "visible_entities", tuple(self.visible_entities))
        object.__setattr__(self, "display_order", tuple(self.display_order))
        object.__setattr__(self, "story_variables", _freeze_variables(self.story_variables))
        object.__setattr__(self, "return_stack", tuple(self.return_stack))
        object.__setattr__(self, "discoveries", frozenset(self.discoveries))


def _freeze_variables(values: Mapping[str, bool | int | float | str]) -> Mapping[str, bool | int | float | str]:
    for key, value in values.items():
        if not key or isinstance(value, str) and not value:
            raise ValueError("剧情变量键和值不能为空")
        if not isinstance(value, (bool, int, float, str)):
            raise TypeError("剧情变量只允许布尔值、数字或字符串")
    return MappingProxyType(dict(values))
