from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class SearchHit:
    id: str
    kind: str
    title: str
    summary: str
    pack_id: str
    version: str


@dataclass(frozen=True, slots=True)
class SearchPage:
    items: tuple[SearchHit, ...]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class ArtifactProjection:
    id: str
    title: str
    museum: dict[str, Any]
    time_range: dict[str, Any]
    material: str
    category: str
    asset_ids: tuple[str, ...]
    fact_card_ids: tuple[str, ...]
    story_entry_ids: tuple[str, ...]
    presentation: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class GalleryStationProjection:
    id: str
    order: int
    time_range: dict[str, Any]
    placement_basis: str
    side: str | None
    artifact: ArtifactProjection
    comparison_artifacts: tuple[ArtifactProjection, ...]
    is_visible: bool
    is_focused: bool


@dataclass(frozen=True, slots=True)
class GalleryProjection:
    id: str
    title: str
    region: dict[str, str]
    status: str
    default_station_id: str | None
    stations: tuple[GalleryStationProjection, ...]
    visible_artifacts: tuple[ArtifactProjection, ...]


@dataclass(frozen=True, slots=True)
class StoryNodeProjection:
    story_id: str
    node_id: str
    narration: str | None
    fact_grade: str
    presentation: dict[str, Any] | None
    allowed_actions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SessionContext:
    session_id: str
    revision: int
    event_seq: int
    mode: str
    focused_artifact: ArtifactProjection | None
    visible_artifacts: tuple[ArtifactProjection, ...]
    story_node: StoryNodeProjection | None


@dataclass(frozen=True, slots=True)
class SourceProjection:
    id: str
    kind: str
    title: str
    locator: dict[str, Any]
    citation_license: str | None


@dataclass(frozen=True, slots=True)
class FactEvidence:
    id: str
    claim: str
    grade: str
    applicable_time: dict[str, Any]
    evidence_note: str | None
    dispute: str | None
    sources: tuple[SourceProjection, ...]


@dataclass(frozen=True, slots=True)
class ContentParagraph:
    content_id: str
    story_id: str | None
    paragraph_number: int
    text: str
    fact_grade: str
    presentation: dict[str, Any] | None
    allowed_actions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ContentPage:
    content_id: str
    content_kind: str
    pack_id: str
    version: str
    title: str
    artifact_id: str | None
    paragraphs: tuple[ContentParagraph, ...]
    related_facts: tuple[FactEvidence, ...]
    next_cursor: str | None
    text_bytes: int
