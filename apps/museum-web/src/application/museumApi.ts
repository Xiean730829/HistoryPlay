import type {
  Artifact,
  ArtifactPresentation,
  CommandAction,
  CommandReceipt,
  SessionProjection,
} from "@history-play/contracts";
import { CommandDispatcher } from "../state/commandDispatcher";

const commandDispatcher = new CommandDispatcher();
const renewedTickets = new Map<string, string>();
const pendingTicketRenewals = new Map<string, Promise<string>>();

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isExpiredSessionCredentialError(error: unknown): error is ApiRequestError {
  // The museum API reports invalid or revoked session bearer credentials as 401.
  // A 403 can instead mean an origin or connection-binding failure and must not
  // silently discard a still-valid browser session.
  return error instanceof ApiRequestError && error.status === 401;
}

export interface SessionContext {
  session_id: string;
  revision: number;
  event_seq: number;
  mode: string;
  focused_artifact: ArtifactProjection | null;
  visible_artifacts: ArtifactProjection[];
  story_node: null | {
    story_id: string;
    node_id: string;
    narration: string | null;
    fact_grade: string;
    presentation: Record<string, unknown> | null;
    allowed_actions: string[];
    available_exits: Array<{
      action: string;
      target_node_id: string;
      route_label?: string;
    }>;
  };
}

export interface StoryParagraph {
  content_id: string;
  version: string;
  paragraph_number: number;
  text: string;
  authorship: { node_id: string; story_id: string | null; fact_grade: string };
  presentation: Record<string, unknown> | null;
  allowed_actions: string[];
}

export interface StoryNodePage {
  content_id: string;
  content_kind: string;
  pack_id: string;
  version: string;
  title: string;
  artifact_id: string | null;
  paragraphs: StoryParagraph[];
  next_cursor: string | null;
}

export type ArtifactProjection = Pick<
  Artifact,
  | "id"
  | "title"
  | "museum"
  | "time_range"
  | "material"
  | "category"
  | "asset_ids"
  | "fact_card_ids"
  | "story_entry_ids"
  | "exhibit_type"
  | "source_ids"
  | "identity"
> & {
  presentation?: ArtifactPresentation | null;
};

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  summary: string;
  pack_id: string;
  version: string;
}

export interface SessionCredentials {
  session_id: string;
  session_token: string;
  pack_id: string;
  version: string;
}

export interface ActiveSession extends SessionCredentials {
  state: SessionProjection;
  connection_id: string;
  control_ticket: string;
  context: SessionContext;
}

export interface SongHotspot {
  station_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}
export interface SongScroll {
  id: string;
  title: string;
  theme: string;
  background_asset_id: string;
  interpretation_label: string;
  station_ids: string[];
  hotspots: SongHotspot[];
}
export interface GalleryStation {
  id: string;
  order: number;
  artifact: ArtifactProjection;
}
export interface GalleryDocument {
  id: string;
  title: string;
  status: string;
  presentation_kind?: string;
  stations: GalleryStation[];
  scrolls?: SongScroll[];
}

export async function loadGalleryDocument(
  session: ActiveSession,
  galleryId: string,
  signal?: AbortSignal,
): Promise<GalleryDocument> {
  return request<GalleryDocument>(
    `/api/sessions/${session.session_id}/galleries/${encodeURIComponent(galleryId)}`,
    { headers: boundHeaders(session), signal },
  );
}

export async function loadGalleryArtifacts(
  session: ActiveSession,
  galleryId: string,
  signal?: AbortSignal,
): Promise<ArtifactProjection[]> {
  const response = await request<{ stations: Array<{ artifact: ArtifactProjection }> }>(
    `/api/sessions/${session.session_id}/galleries/${encodeURIComponent(galleryId)}`,
    { headers: boundHeaders(session), signal },
  );
  return response.stations.map((station) => station.artifact);
}

/** Read only the currently committed node from the session's pinned published pack. */
export async function readStoryNode(
  session: ActiveSession,
  nodeId: string,
  signal: AbortSignal,
): Promise<StoryNodePage> {
  const params = new URLSearchParams({
    pack_id: session.pack_id,
    version: session.version,
    content_id: nodeId,
    limit: "1",
  });
  return request<StoryNodePage>(
    `/api/sessions/${encodeURIComponent(session.session_id)}/content?${params.toString()}`,
    { headers: boundHeaders(session), signal },
  );
}

export async function enterStory(
  session: ActiveSession,
  storyId: string,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  return dispatchSessionCommand(session, "enter_story", storyId);
}

export async function continueStory(
  session: ActiveSession,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  return dispatchSessionCommand(session, "continue_story", session.state.story_id ?? undefined);
}

export async function chooseStoryRoute(
  session: ActiveSession,
  targetNodeId: string,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  return dispatchSessionCommand(session, "choose_route", targetNodeId);
}

export async function returnToExhibit(
  session: ActiveSession,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  return dispatchSessionCommand(session, "return_to_exhibit");
}

async function dispatchSessionCommand(
  session: ActiveSession,
  action: CommandAction,
  targetId?: string,
  params?: Record<string, unknown>,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const dispatchKey = [session.session_id, action, targetId ?? "", session.state.revision,
    session.state.view_revision, session.state.interaction_epoch, JSON.stringify(params ?? {})].join(":");
  const receipt = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${encodeURIComponent(session.session_id)}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        expected_view_revision: session.state.view_revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
        ...(targetId ? { target_id: targetId } : {}),
        ...(params ? { params } : {}),
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt };
}

export function locateArtifact(session: ActiveSession, artifactId: string) {
  return dispatchSessionCommand(session, "locate_artifact", artifactId);
}

/** Opening the current exhibit's observation camera does not require another mutation. */
export async function prepareArtifactInspection(session: ActiveSession, artifactId: string): Promise<{
  session: ActiveSession; receipt: CommandReceipt | null;
}> {
  if (session.state.focused_entity_id === artifactId) return { session, receipt: null };
  return locateArtifact(session, artifactId);
}

export function setArtifactView(session: ActiveSession, camera: { yaw: number; pitch: number; zoom: number }) {
  return dispatchSessionCommand(session, "set_view", undefined, { camera });
}

interface SessionResponse {
  session_token: string;
  state: SessionProjection;
}

interface PairResponse {
  connection_id: string;
  control_ticket: string;
}

export interface EventTicketResponse {
  ticket: string;
  ticket_ttl_seconds: number;
}

interface SearchResponse {
  items: SearchHit[];
  next_cursor: string | null;
}

export async function createSession(packId: string, version: string): Promise<SessionCredentials> {
  const response = await request<SessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ pack_id: packId, version }),
  });
  return {
    session_id: response.state.session_id,
    session_token: response.session_token,
    pack_id: packId,
    version,
  };
}

export async function restoreSession(credentials: SessionCredentials): Promise<ActiveSession> {
  const headers = authHeaders(credentials);
  const pair = await request<PairResponse>(`/api/sessions/${credentials.session_id}/pair`, {
    method: "POST",
    headers,
  });
  const boundHeaders = {
    ...headers,
    "X-Museum-Connection": pair.connection_id,
  };
  const [state, context] = await Promise.all([
    request<SessionProjection>(`/api/sessions/${credentials.session_id}`, { headers }),
    request<SessionContext>(`/api/sessions/${credentials.session_id}/context`, {
      headers: boundHeaders,
    }),
  ]);
  return { ...credentials, state, context, ...pair };
}

export async function searchArtifacts(
  session: ActiveSession,
  query: string,
): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, kind: "artifact", limit: "50" });
  const response = await request<SearchResponse>(
    `/api/sessions/${session.session_id}/search?${params.toString()}`,
    { headers: boundHeaders(session) },
  );
  return response.items;
}

export async function requestEventTicket(session: ActiveSession): Promise<EventTicketResponse> {
  return request<EventTicketResponse>(`/api/sessions/${session.session_id}/events/ticket`, {
    method: "POST",
    headers: boundHeaders(session),
  });
}

export async function unpairSession(session: ActiveSession): Promise<void> {
  await request<{ status: string }>(`/api/sessions/${session.session_id}/pair`, {
    method: "DELETE",
    headers: boundHeaders(session),
  });
  renewedTickets.delete(`${session.session_id}:${session.connection_id}`);
}

export async function openArtifact(
  session: ActiveSession,
  artifactId: string,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const action = "open_artifact" satisfies CommandAction;
  const dispatchKey = [session.session_id, action, artifactId, session.state.revision,
    session.state.interaction_epoch].join(":");
  const response = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${session.session_id}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
        target_id: artifactId,
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt: response };
}

export async function enterGallery(
  session: ActiveSession,
  galleryId: string,
  pageSize?: 1 | 2 | 3 | 4,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const action = "enter_gallery" satisfies CommandAction;
  const dispatchKey = [
    session.session_id,
    action,
    galleryId,
    pageSize ?? "default",
    session.state.revision,
    session.state.view_revision,
    session.state.interaction_epoch,
  ].join(":");
  const response = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${session.session_id}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        expected_view_revision: session.state.view_revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
        target_id: galleryId,
        ...(pageSize !== undefined ? { params: { page_size: pageSize } } : {}),
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt: response };
}

export async function moveGalleryStation(
  session: ActiveSession,
  direction: "next" | "previous",
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const action = (direction === "next" ? "move_next" : "move_previous") satisfies CommandAction;
  const dispatchKey = [
    session.session_id,
    action,
    session.state.revision,
    session.state.view_revision,
    session.state.interaction_epoch,
  ].join(":");
  const response = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${session.session_id}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        expected_view_revision: session.state.view_revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt: response };
}

export async function browseGalleryWindow(
  session: ActiveSession,
  direction: "next" | "previous",
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const action = "browse_gallery" satisfies CommandAction;
  const dispatchKey = [
    session.session_id,
    action,
    direction,
    session.state.revision,
    session.state.view_revision,
    session.state.interaction_epoch,
  ].join(":");
  const response = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${session.session_id}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        expected_view_revision: session.state.view_revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
        params: { direction },
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt: response };
}

export async function seekGalleryTimeRange(
  session: ActiveSession,
  range: { start_year: number; end_year: number } | { clear: true },
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const action = "seek_time_range" satisfies CommandAction;
  const params = "clear" in range ? { clear: true } : { start_year: range.start_year, end_year: range.end_year };
  const dispatchKey = [
    session.session_id,
    action,
    JSON.stringify(params),
    session.state.revision,
    session.state.view_revision,
    session.state.interaction_epoch,
  ].join(":");
  const response = await commandDispatcher.dispatch(dispatchKey, (requestId) => request<CommandReceipt>(
    `/api/sessions/${session.session_id}/commands`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify({
        schema_version: "1",
        request_id: requestId,
        expected_revision: session.state.revision,
        expected_view_revision: session.state.view_revision,
        interaction_epoch: session.state.interaction_epoch,
        control_ticket: session.control_ticket,
        action,
        params,
      }),
    },
    (status, body) => status === 409 && isCommandReceipt(body),
  ));
  return { session: await refreshSession(session), receipt: response };
}

export interface RenderReceiptPayload {
  request_id: string;
  payload_digest: string;
  revision: number;
  view_revision: number;
  interaction_epoch: number;
  status: "rendered" | "degraded";
  reason?: string;
}

/** Report only what the active browser renderer has actually put on screen. */
export async function reportRenderReceipt(
  session: ActiveSession,
  payload: RenderReceiptPayload,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(session.session_id)}/render-receipts`,
    {
      method: "POST",
      headers: boundHeaders(session),
      body: JSON.stringify(payload),
    },
  );
}

/** Authenticated asset bytes; caller owns cancellation and object-URL lifetime. */
export async function loadSessionAssetBlob(
  session: SessionCredentials,
  assetId: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(session.session_id)}/assets/${encodeURIComponent(assetId)}`,
    { headers: authHeaders(session), signal },
  );
  if (!response.ok) {
    throw new Error(response.status === 404 ? "展示资产不可用" : `展示资产返回 ${response.status}`);
  }
  return response.blob();
}

export async function refreshSession(session: ActiveSession): Promise<ActiveSession> {
  const headers = authHeaders(session);
  const bound = boundHeaders(session);
  const [state, context] = await Promise.all([
    request<SessionProjection>(`/api/sessions/${session.session_id}`, { headers }),
    request<SessionContext>(`/api/sessions/${session.session_id}/context`, { headers: bound }),
  ]);
  return { ...session, state, context };
}

function authHeaders(credentials: SessionCredentials): HeadersInit {
  return { Authorization: `Bearer ${credentials.session_token}` };
}

function boundHeaders(session: ActiveSession): HeadersInit {
  return {
    ...authHeaders(session),
    "X-Museum-Connection": session.connection_id,
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  acceptError?: (status: number, body: unknown) => boolean,
): Promise<T> {
  const headers = { "Content-Type": "application/json", ...init.headers };
  const command = /^\/api\/sessions\/([^/]+)\/commands$/.exec(path);
  const connection = new Headers(headers).get("X-Museum-Connection");
  const scope = command && connection ? `${command[1]}:${connection}` : null;
  let payload: Record<string, unknown> | null = null;
  if (scope && typeof init.body === "string") {
    try { payload = JSON.parse(init.body) as Record<string, unknown>; } catch { payload = null; }
  }
  const send = (ticket?: string) => fetch(path, {
    ...init,
    headers,
    body: ticket && payload ? JSON.stringify({ ...payload, control_ticket: ticket }) : init.body,
  });
  let response = await send(scope ? renewedTickets.get(scope) : undefined);
  let text = await response.text();
  // An expired grant fails before the command can commit. Renew only for the
  // same authenticated, still-bound connection, then replay the same request id.
  if (response.status === 403 && text.trim() === "控制票据已过期" && command && scope && payload) {
    let pending = pendingTicketRenewals.get(scope);
    if (!pending) {
      pending = request<{ control_ticket: string }>(`/api/sessions/${command[1]}/control-ticket`, {
        method: "POST", headers,
      }).then((result) => {
        if (!result.control_ticket) throw new Error("服务未返回新的控制票据");
        if (renewedTickets.size >= 32) renewedTickets.clear();
        renewedTickets.set(scope, result.control_ticket);
        return result.control_ticket;
      }).finally(() => { pendingTicketRenewals.delete(scope); });
      pendingTicketRenewals.set(scope, pending);
    }
    response = await send(await pending);
    text = await response.text();
  }
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok && !acceptError?.(response.status, body)) {
    const detail = typeof body === "object" && body !== null && "message" in body
      ? String(body.message)
      : text || `服务返回 ${response.status}`;
    if (response.status === 403 && /未绑定|配对替代|绑定失效/.test(detail)) {
      throw new ApiRequestError(
        403,
        "展台绑定已失效，请在当前页面重新开启语音后再试。这不是文物缺少资料。",
      );
    }
    throw new ApiRequestError(response.status, detail);
  }
  return body as T;
}

function isCommandReceipt(value: unknown): value is CommandReceipt {
  return (
    typeof value === "object" &&
    value !== null &&
    "receipt_id" in value &&
    "status" in value &&
    "request_id" in value
  );
}
