// 由 tools/dev/generate_contracts.py 从 contracts/schemas/v1 生成，请勿手改。
export type NamespacedId = string;
export type OpaqueId = string;
export type NonEmptyText = string;
export type NonNegativeInt = number;
export type FactGrade = "F" | "R" | "C" | "H" | "U";
export type CapabilityId = "artifact3d" | "comic" | "map" | "timeline" | "relationship_graph" | "compare";
export type SessionMode = "explore" | "story" | "qa" | "hypothesis";
export type CommandAction = "open_artifact" | "enter_gallery" | "move_next" | "move_previous" | "locate_artifact" | "return_to_exhibit" | "enter_story" | "continue_story" | "choose_route" | "pause_story" | "return_to_story" | "focus_detail" | "set_view" | "choose_action";
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
  /** Explicit search aliases, including common Chinese names; never inferred from unpublished sources. */
  aliases?: Array<string>;
  museum: ArtifactMuseum;
  time_range: TimeRange;
  material: NonEmptyText;
  category: NonEmptyText;
  /** Logical digital asset IDs. Replacing a model does not change this artifact ID. */
  asset_ids: Array<NamespacedId>;
  /** Optional explicit presentation bindings. The display source is a model or a photo, never whichever asset happens to be first. */
  presentation?: ArtifactPresentation;
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
  /** Target gallery for enter_gallery, target node for choose_route, or target artifact for artifact-directed actions. Never a client-provided position. */
  target_id?: NamespacedId;
  params?: CommandObject;
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
  dependencies?: Array<ContentPackDependencies>;
}

export interface SessionEvent {
  schema_version: "1";
  /** Monotonic delivery sequence. Clients that see a gap must request a snapshot. */
  event_seq: NonNegativeInt;
  session_id: OpaqueId;
  kind: "snapshot" | "focus_changed" | "story_entered" | "story_advanced" | "story_paused" | "returned_to_story" | "returned_to_exhibit" | "qa_entered" | "view_changed" | "command_committed" | "render_updated";
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

export interface GalleryStation {
  id: NamespacedId;
  /** Stable curator-defined order, independent from frame coordinates or uncertain date overlap. */
  order: number;
  time_range: TimeRange;
  /** Why this object belongs at this point in the visitor route; do not imply a precise creation order when dates overlap. */
  placement_basis: string;
  artifact_id: NamespacedId;
  /** Other real artifacts shown for comparison at this station, with their own identity and region retained. */
  comparison_artifact_ids?: Array<NamespacedId>;
  side?: "left" | "center" | "right";
}

export interface Gallery {
  id: NamespacedId;
  title: NonEmptyText;
  region: ContentPackRegion;
  status: "open" | "planned" | "closed";
  default_station_id?: NamespacedId;
  stations: Array<GalleryStation>;
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

export interface McpToolCallConnect {
  tool: "museum_connect";
  pair_code: string;
}

export interface McpToolCallGetContext {
  tool: "museum_get_context";
  cursor?: string;
  receipt_id?: OpaqueId;
}

export interface McpToolCallSearch {
  tool: "museum_search";
  query: string;
  kind?: "artifact" | "event" | "story" | "fact";
  cursor?: string;
}

export interface McpToolCallReadContent {
  tool: "museum_read_content";
  content_id: NamespacedId;
  cursor?: string;
}

export interface McpToolCallAct {
  tool: "museum_act";
  action: CommandAction;
  target_id?: NamespacedId;
  request_id: OpaqueId;
  expected_revision: NonNegativeInt;
  expected_view_revision?: NonNegativeInt;
  /** Navigation actions require the current input epoch so interrupted commands cannot move the session. */
  interaction_epoch?: NonNegativeInt;
  control_ticket?: string;
  params?: CommandObject;
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
  /** Legacy nested anchor accepted for older projections; new projections use the session-level field. */
  exhibit_return_point?: SessionProjectionExhibitReturnPoint;
}

export interface SessionProjectionExhibitReturnPoint {
  gallery_id: NamespacedId;
  station_id: NamespacedId;
  focused_entity_id?: NamespacedId;
  view: SessionProjectionObject;
  view_revision?: NonNegativeInt;
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
  /** Published gallery fixed for this visit. Optional for sessions created before gallery navigation was introduced. */
  gallery_id?: NamespacedId;
  /** Authoritative current station; clients must not infer it from animation coordinates. */
  station_id?: NamespacedId;
  /** Legacy location anchor retained for older clients; new projections also provide station_id. */
  current_location_id?: NamespacedId;
  focused_entity_id?: NamespacedId;
  /** Persisted target camera pose; view_revision changes atomically with this value. */
  camera_pose?: SessionProjectionObject;
  /** Optional root gallery anchor captured on the first story entry from exploration. */
  exhibit_return_point?: SessionProjectionExhibitReturnPoint;
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
  /** The single authored text body for this stable node ID; do not duplicate it in artifact presentation metadata. */
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
  /** Fact cards that ground this story; each claim links its own sources. */
  fact_card_ids?: Array<NamespacedId>;
  artifact_id?: NamespacedId;
  return_to_exhibit?: boolean;
}

export interface VoiceEvent {
  schema_version: "1";
  kind: "speech_started" | "speech_ended" | "transcript_partial" | "transcript_final" | "interrupt" | "playback_started" | "playback_drained" | "playback_stopped" | "connection_changed";
  /** Provenance of this event. unknown must not be treated as a cloud turn id. */
  source: "local_vad" | "local_player" | "browser" | "voice_bridge" | "unknown";
  connection_id: OpaqueId;
  /** Local input turn. Not a vendor task id and not mintable by the model. */
  local_turn_id?: OpaqueId;
  /** Vendor turn id when actually observed; null means unknown. Do not invent one. */
  vendor_turn_id?: string | unknown;
  occurred_at: string;
  text?: string;
  connected?: boolean;
}

export interface ArtifactMuseum {
  name: NonEmptyText;
  accession: NonEmptyText;
  collection_url?: string;
}

export interface ArtifactPresentation {
  /** Stable ID of a real preview image; never inferred from asset_ids order. */
  preview_asset_id: NamespacedId;
  display: ArtifactDisplay;
  default_camera?: ArtifactDefaultCamera;
  /** One-line exhibit introduction; the longer background remains in the referenced story node. */
  teaser: string;
  /** Stable story-node ID containing the single authored background narration. */
  background_node_id: NamespacedId;
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

export interface CommandObject {
  intent?: string;
  /** Untrusted player utterance. Must map to a declared intent before rules run. */
  input_text?: string;
  camera?: SessionProjectionObject;
}

export interface ContentPackRegion {
  id: string;
  label: NonEmptyText;
}

export interface ContentPackDependencies {
  pack_id: NamespacedId;
  version: string;
}

export interface HistoricalEventPlace {
  label: NonEmptyText;
  region_id?: string;
}

export interface SessionProjectionObject {
  yaw: number;
  pitch: number;
  zoom: number;
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
  /** Stable audio asset ID for this node's narration; the text body remains the node's narration field. */
  audio_asset_id?: NamespacedId;
}

export interface StoryNodeExits {
  action: "continue_story" | "choose_route" | "enter_hypothesis" | "return_to_exhibit";
  target_node_id: NamespacedId;
  /** Short visitor-facing label for an explicit route choice. */
  route_label?: string;
  when?: StoryNodeCondition;
}

export interface ArtifactDisplay {
  /** Explicit display medium, checked against the referenced asset kind. */
  kind: "model3d" | "photo";
  /** Stable ID of the display model or photograph. */
  asset_id: NamespacedId;
}

export interface ArtifactDefaultCamera {
  /** Curator-selected initial orbit preset for the bound display model. */
  orbit: NonEmptyText;
  target_note?: string;
}

export type McpToolCall = McpToolCallConnect | McpToolCallGetContext | McpToolCallSearch | McpToolCallReadContent | McpToolCallAct;
