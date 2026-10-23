// 由 tools/dev/generate_contracts.py 从 contracts/schemas/v1 生成，请勿手改。
export type NamespacedId = string;
export type OpaqueId = string;
export type NonEmptyText = string;
export type NonNegativeInt = number;
export type FactGrade = "F" | "R" | "C" | "H" | "U";
export type CapabilityId = "artifact3d" | "comic" | "map" | "timeline" | "relationship_graph" | "compare";
export type SessionMode = "explore" | "story" | "qa" | "hypothesis";
export type CommandAction = "open_artifact" | "enter_story" | "continue_story" | "pause_story" | "return_to_story" | "focus_detail" | "set_view" | "choose_action";
export type VariableValue = boolean | number | string;

export interface TimeRange {
  start_year: number;
  end_year: number;
  precision: "year" | "decade" | "century" | "range" | "unknown";
  calendar_note?: string;
  display_label?: string;
  uncertainty?: string;
}

export interface Artifact {
  id: NamespacedId;
  title: NonEmptyText;
  museum: ArtifactMuseum;
  time_range: TimeRange;
  material: NonEmptyText;
  category: NonEmptyText;
  /** Logical digital asset IDs. Replacing a model does not change this artifact ID. */
  asset_ids: Array<NamespacedId>;
  fact_card_ids?: Array<NamespacedId>;
  story_entry_ids?: Array<NamespacedId>;
  identity_unknown?: boolean;
}

export interface Asset {
  id: NamespacedId;
  kind: "model3d" | "image" | "audio" | "comic" | "preview";
  format: "glb" | "jpg" | "png" | "webp" | "mp3" | "ogg";
  sha256: string;
  byte_size: number;
  license: AssetLicense;
  derived_from?: NamespacedId;
  lod?: "source" | "display" | "mobile";
  framing?: AssetFraming;
  hotspots?: Array<AssetHotspots>;
  fallback_asset_id?: NamespacedId;
}

export interface CommandActionParams {
  intent?: string;
  /** Untrusted player utterance. Must map to a declared intent before rules run. */
  input_text?: string;
  camera?: CommandCameraPose;
}

export interface CommandCameraPose {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface Command {
  schema_version: "1";
  /** Idempotency key. Same ID and payload retries the original receipt; same ID different payload conflicts. */
  request_id: OpaqueId;
  expected_revision: NonNegativeInt;
  expected_view_revision?: NonNegativeInt;
  interaction_epoch: NonNegativeInt;
  /** Opaque short-lived ticket issued by the application. Models must not mint this. */
  control_ticket?: string;
  action: CommandAction;
  target_id?: NamespacedId;
  params?: CommandActionParams;
}

export interface ContentPack {
  id: NamespacedId;
  version: string;
  schema_version: "1";
  language: string;
  region: ContentPackRegion;
  time_range: TimeRange;
  required_capabilities: Array<CapabilityId>;
  publication_status: "draft" | "reviewed" | "published" | "retired";
  title?: NonEmptyText;
}

export interface SessionEvent {
  schema_version: "1";
  /** Monotonic delivery sequence. Clients that see a gap must request a snapshot. */
  event_seq: NonNegativeInt;
  session_id: OpaqueId;
  kind: "snapshot" | "focus_changed" | "story_entered" | "story_advanced" | "story_paused" | "returned_to_story" | "qa_entered" | "view_changed" | "command_committed" | "render_updated";
  revision: NonNegativeInt;
  view_revision?: NonNegativeInt;
  interaction_epoch: NonNegativeInt;
  request_id?: OpaqueId;
  receipt_id?: OpaqueId;
  projection?: SessionProjection;
}

export interface FactCard {
  id: NamespacedId;
  claim: string;
  grade: FactGrade;
  applicable_time: TimeRange;
  source_ids: Array<NamespacedId>;
  evidence_note?: string;
  dispute?: string;
  reviewer?: string;
}

export interface HistoricalEvent {
  id: NamespacedId;
  title: NonEmptyText;
  time_range: TimeRange;
  place: HistoricalEventPlace;
  participant_ids?: Array<NamespacedId>;
  fact_card_ids: Array<NamespacedId>;
  /** Thematic links only. Listing an artifact does not mean it witnessed the event. */
  related_artifact_ids?: Array<NamespacedId>;
  tell_story_id?: NamespacedId;
  role_story_id?: NamespacedId;
}

export interface CommandReceipt {
  schema_version: "1";
  receipt_id: OpaqueId;
  request_id: OpaqueId;
  session_id: OpaqueId;
  /** committed means persisted; rendered means the named client presented it; render_pending must not be described as success. */
  status: "committed" | "rendered" | "degraded" | "render_pending" | "rejected";
  revision: NonNegativeInt;
  view_revision?: NonNegativeInt;
  interaction_epoch: NonNegativeInt;
  action?: CommandAction;
  asset_id?: NamespacedId;
  reason?: string;
  /** Digest of the original command payload. Same request_id with a different digest is a conflict. */
  payload_digest?: string;
}

export interface Relation {
  id: NamespacedId;
  /** physical object link, contemporaneous, interpretive, or authored connection. */
  kind: "physical" | "same_period" | "explanatory" | "created";
  from_id: NamespacedId;
  to_id: NamespacedId;
  fact_card_id?: NamespacedId;
  note?: string;
}

export interface SessionProjectionReturnPoint {
  story_id: NamespacedId;
  node_id: NamespacedId;
  revision: NonNegativeInt;
  story_variables?: Record<string, VariableValue>;
  narration_checkpoint?: SessionProjectionNarrationCheckpoint;
}

export interface SessionProjectionNarrationCheckpoint {
  last_started_node_id?: NamespacedId;
  last_completed_node_id?: NamespacedId;
}

export interface SessionProjection {
  schema_version: "1";
  session_id: OpaqueId;
  /** Published pack versions fixed for this session. Runtime must not search unpublished drafts. */
  pack_versions: Record<NamespacedId, string>;
  world_time?: TimeRange;
  current_location_id?: NamespacedId;
  focused_entity_id?: NamespacedId;
  visible_entities?: Array<NamespacedId>;
  /** Server-authored order used to resolve 'the second one'. Clients must not reorder it. */
  display_order: Array<NamespacedId>;
  story_id?: NamespacedId;
  node_id?: NamespacedId;
  mode: SessionMode;
  story_variables?: Record<string, VariableValue>;
  return_stack?: Array<SessionProjectionReturnPoint>;
  /** Story, focus or scene commits. Not incremented by per-frame camera motion. */
  revision: NonNegativeInt;
  view_revision: NonNegativeInt;
  event_seq: NonNegativeInt;
  /** Increments on a new local input or interrupt so old control tickets fail. */
  interaction_epoch: NonNegativeInt;
  discoveries?: Array<string>;
  narration_checkpoint?: SessionProjectionNarrationCheckpoint;
  allowed_actions?: Array<CommandAction>;
}

export interface Source {
  id: NamespacedId;
  kind: "museum_record" | "excavation" | "book" | "article" | "open_text";
  title: NonEmptyText;
  locator: SourceLocator;
  citation_license?: string;
}

export interface StoryNodeCondition {
  op: "all" | "any" | "equals" | "greater_or_equal" | "has_discovery";
  path?: string;
  value?: boolean | number | string;
  items?: Array<StoryNodeCondition>;
}

export interface StoryNodeEffect {
  op: "set" | "add_discovery";
  path: string;
  value?: boolean | number | string;
}

export interface StoryNode {
  id: NamespacedId;
  story_id: NamespacedId;
  fact_grade: FactGrade;
  presentation?: StoryNodePresentation;
  narration?: string;
  allowed_actions: Array<"observe" | "ask" | "switch_perspective" | "choose_route" | "compare_evidence" | "enter_hypothesis" | "continue_story" | "return_to_exhibit">;
  enter_when?: StoryNodeCondition;
  effects?: Array<StoryNodeEffect>;
  exits: Array<StoryNodeExits>;
  return_checkpoint?: boolean;
}

export interface Story {
  id: NamespacedId;
  title: NonEmptyText;
  entry_node_id: NamespacedId;
  node_ids: Array<NamespacedId>;
  artifact_id?: NamespacedId;
  return_to_exhibit?: boolean;
}

export interface ArtifactMuseum {
  name: NonEmptyText;
  accession: NonEmptyText;
  collection_url?: string;
}

export interface AssetLicense {
  spdx: string;
  attribution: string;
  url?: string;
}

export interface AssetFraming {
  camera_orbit?: string;
  orientation_note?: string;
}

export interface AssetHotspots {
  id: string;
  label: NonEmptyText;
}

export interface ContentPackRegion {
  id: string;
  label: NonEmptyText;
}

export interface HistoricalEventPlace {
  label: NonEmptyText;
  region_id?: string;
}

export interface SourceLocator {
  label: string;
  url?: string;
  volume?: string;
  accessed_on?: string;
}

export interface StoryNodePresentation {
  capability: CapabilityId;
  asset_ids?: Array<NamespacedId>;
}

export interface StoryNodeExits {
  action: "continue_story" | "choose_route" | "enter_hypothesis" | "return_to_exhibit";
  target_node_id: NamespacedId;
  when?: StoryNodeCondition;
}
