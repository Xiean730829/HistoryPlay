from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

# 由 tools/dev/generate_contracts.py 从 contracts/schemas/v1 生成，请勿手改。

type NamespacedId = str
type OpaqueId = str
type NonEmptyText = str
type NonNegativeInt = int
type FactGrade = Literal["F", "R", "C", "H", "U"]
type CapabilityId = Literal["artifact3d", "comic", "map", "timeline", "relationship_graph", "compare"]
type SessionMode = Literal["explore", "story", "qa", "hypothesis"]
type CommandAction = Literal["open_artifact", "enter_story", "continue_story", "pause_story", "return_to_story", "focus_detail", "set_view", "choose_action"]
type VariableValue = bool | int | float | str

class TimeRange(TypedDict):
    start_year: int
    end_year: int
    precision: Literal["year", "decade", "century", "range", "unknown"]
    calendar_note: NotRequired[str]
    display_label: NotRequired[str]
    uncertainty: NotRequired[str]

class Artifact(TypedDict):
    id: NamespacedId
    title: NonEmptyText
    museum: ArtifactMuseum
    time_range: TimeRange
    material: NonEmptyText
    category: NonEmptyText
    asset_ids: list[NamespacedId]
    fact_card_ids: NotRequired[list[NamespacedId]]
    story_entry_ids: NotRequired[list[NamespacedId]]
    identity_unknown: NotRequired[bool]

class Asset(TypedDict):
    id: NamespacedId
    kind: Literal["model3d", "image", "audio", "comic", "preview"]
    format: Literal["glb", "jpg", "png", "webp", "mp3", "ogg"]
    sha256: str
    byte_size: int
    license: AssetLicense
    derived_from: NotRequired[NamespacedId]
    lod: NotRequired[Literal["source", "display", "mobile"]]
    framing: NotRequired[AssetFraming]
    hotspots: NotRequired[list[AssetHotspots]]
    fallback_asset_id: NotRequired[NamespacedId]

class CommandActionParams(TypedDict):
    intent: NotRequired[str]
    input_text: NotRequired[str]
    camera: NotRequired[CommandCameraPose]

class CommandCameraPose(TypedDict):
    yaw: float
    pitch: float
    zoom: float

class Command(TypedDict):
    schema_version: Literal["1"]
    request_id: OpaqueId
    expected_revision: NonNegativeInt
    expected_view_revision: NotRequired[NonNegativeInt]
    interaction_epoch: NonNegativeInt
    control_ticket: NotRequired[str]
    action: CommandAction
    target_id: NotRequired[NamespacedId]
    params: NotRequired[CommandActionParams]

class ContentPack(TypedDict):
    id: NamespacedId
    version: str
    schema_version: Literal["1"]
    language: str
    region: ContentPackRegion
    time_range: TimeRange
    required_capabilities: list[CapabilityId]
    publication_status: Literal["draft", "reviewed", "published", "retired"]
    title: NotRequired[NonEmptyText]

class SessionEvent(TypedDict):
    schema_version: Literal["1"]
    event_seq: NonNegativeInt
    session_id: OpaqueId
    kind: Literal["snapshot", "focus_changed", "story_entered", "story_advanced", "story_paused", "returned_to_story", "qa_entered", "view_changed", "command_committed", "render_updated"]
    revision: NonNegativeInt
    view_revision: NotRequired[NonNegativeInt]
    interaction_epoch: NonNegativeInt
    request_id: NotRequired[OpaqueId]
    receipt_id: NotRequired[OpaqueId]
    projection: NotRequired[SessionProjection]

class FactCard(TypedDict):
    id: NamespacedId
    claim: str
    grade: FactGrade
    applicable_time: TimeRange
    source_ids: list[NamespacedId]
    evidence_note: NotRequired[str]
    dispute: NotRequired[str]
    reviewer: NotRequired[str]

class HistoricalEvent(TypedDict):
    id: NamespacedId
    title: NonEmptyText
    time_range: TimeRange
    place: HistoricalEventPlace
    participant_ids: NotRequired[list[NamespacedId]]
    fact_card_ids: list[NamespacedId]
    related_artifact_ids: NotRequired[list[NamespacedId]]
    tell_story_id: NotRequired[NamespacedId]
    role_story_id: NotRequired[NamespacedId]

class CommandReceipt(TypedDict):
    schema_version: Literal["1"]
    receipt_id: OpaqueId
    request_id: OpaqueId
    session_id: OpaqueId
    status: Literal["committed", "rendered", "degraded", "render_pending", "rejected"]
    revision: NonNegativeInt
    view_revision: NotRequired[NonNegativeInt]
    interaction_epoch: NonNegativeInt
    action: NotRequired[CommandAction]
    asset_id: NotRequired[NamespacedId]
    reason: NotRequired[str]
    payload_digest: NotRequired[str]

class Relation(TypedDict):
    id: NamespacedId
    kind: Literal["physical", "same_period", "explanatory", "created"]
    from_id: NamespacedId
    to_id: NamespacedId
    fact_card_id: NotRequired[NamespacedId]
    note: NotRequired[str]

class SessionProjectionReturnPoint(TypedDict):
    story_id: NamespacedId
    node_id: NamespacedId
    revision: NonNegativeInt
    story_variables: NotRequired[dict[str, VariableValue]]
    narration_checkpoint: NotRequired[SessionProjectionNarrationCheckpoint]

class SessionProjectionNarrationCheckpoint(TypedDict):
    last_started_node_id: NotRequired[NamespacedId]
    last_completed_node_id: NotRequired[NamespacedId]

class SessionProjection(TypedDict):
    schema_version: Literal["1"]
    session_id: OpaqueId
    pack_versions: dict[NamespacedId, str]
    world_time: NotRequired[TimeRange]
    current_location_id: NotRequired[NamespacedId]
    focused_entity_id: NotRequired[NamespacedId]
    visible_entities: NotRequired[list[NamespacedId]]
    display_order: list[NamespacedId]
    story_id: NotRequired[NamespacedId]
    node_id: NotRequired[NamespacedId]
    mode: SessionMode
    story_variables: NotRequired[dict[str, VariableValue]]
    return_stack: NotRequired[list[SessionProjectionReturnPoint]]
    revision: NonNegativeInt
    view_revision: NonNegativeInt
    event_seq: NonNegativeInt
    interaction_epoch: NonNegativeInt
    discoveries: NotRequired[list[str]]
    narration_checkpoint: NotRequired[SessionProjectionNarrationCheckpoint]
    allowed_actions: NotRequired[list[CommandAction]]

class Source(TypedDict):
    id: NamespacedId
    kind: Literal["museum_record", "excavation", "book", "article", "open_text"]
    title: NonEmptyText
    locator: SourceLocator
    citation_license: NotRequired[str]

class StoryNodeCondition(TypedDict):
    op: Literal["all", "any", "equals", "greater_or_equal", "has_discovery"]
    path: NotRequired[str]
    value: NotRequired[bool | float | str]
    items: NotRequired[list[StoryNodeCondition]]

class StoryNodeEffect(TypedDict):
    op: Literal["set", "add_discovery"]
    path: str
    value: NotRequired[bool | float | str]

class StoryNode(TypedDict):
    id: NamespacedId
    story_id: NamespacedId
    fact_grade: FactGrade
    presentation: NotRequired[StoryNodePresentation]
    narration: NotRequired[str]
    allowed_actions: list[Literal["observe", "ask", "switch_perspective", "choose_route", "compare_evidence", "enter_hypothesis", "continue_story", "return_to_exhibit"]]
    enter_when: NotRequired[StoryNodeCondition]
    effects: NotRequired[list[StoryNodeEffect]]
    exits: list[StoryNodeExits]
    return_checkpoint: NotRequired[bool]

class Story(TypedDict):
    id: NamespacedId
    title: NonEmptyText
    entry_node_id: NamespacedId
    node_ids: list[NamespacedId]
    artifact_id: NotRequired[NamespacedId]
    return_to_exhibit: NotRequired[bool]

class ArtifactMuseum(TypedDict):
    name: NonEmptyText
    accession: NonEmptyText
    collection_url: NotRequired[str]

class AssetLicense(TypedDict):
    spdx: str
    attribution: str
    url: NotRequired[str]

class AssetFraming(TypedDict):
    camera_orbit: NotRequired[str]
    orientation_note: NotRequired[str]

class AssetHotspots(TypedDict):
    id: str
    label: NonEmptyText

class ContentPackRegion(TypedDict):
    id: str
    label: NonEmptyText

class HistoricalEventPlace(TypedDict):
    label: NonEmptyText
    region_id: NotRequired[str]

class SourceLocator(TypedDict):
    label: str
    url: NotRequired[str]
    volume: NotRequired[str]
    accessed_on: NotRequired[str]

class StoryNodePresentation(TypedDict):
    capability: CapabilityId
    asset_ids: NotRequired[list[NamespacedId]]

class StoryNodeExits(TypedDict):
    action: Literal["continue_story", "choose_route", "enter_hypothesis", "return_to_exhibit"]
    target_node_id: NamespacedId
    when: NotRequired[StoryNodeCondition]
