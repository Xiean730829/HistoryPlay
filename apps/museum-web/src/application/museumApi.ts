import type { Artifact, CommandAction, CommandReceipt, SessionProjection } from "@history-play/contracts";

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
  };
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
>;

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

interface SessionResponse {
  session_token: string;
  state: SessionProjection;
}

interface PairResponse {
  connection_id: string;
  control_ticket: string;
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

export async function unpairSession(session: ActiveSession): Promise<void> {
  await request<{ status: string }>(`/api/sessions/${session.session_id}/pair`, {
    method: "DELETE",
    headers: boundHeaders(session),
  });
}

export async function openArtifact(
  session: ActiveSession,
  artifactId: string,
): Promise<{ session: ActiveSession; receipt: CommandReceipt }> {
  const response = await request<CommandReceipt>(`/api/sessions/${session.session_id}/commands`, {
    method: "POST",
    headers: boundHeaders(session),
    body: JSON.stringify({
      schema_version: "1",
      request_id: crypto.randomUUID(),
      expected_revision: session.state.revision,
      interaction_epoch: session.state.interaction_epoch,
      control_ticket: session.control_ticket,
      action: "open_artifact" satisfies CommandAction,
      target_id: artifactId,
    }),
  }, (status, body) => status === 409 && isCommandReceipt(body));
  return { session: await refreshSession(session), receipt: response };
}

async function refreshSession(session: ActiveSession): Promise<ActiveSession> {
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
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
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
    throw new Error(detail);
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
