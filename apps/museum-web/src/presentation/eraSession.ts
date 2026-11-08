import {
  createSession, restoreSession, enterGallery, unpairSession,
  type ActiveSession, type SessionCredentials,
} from "../application/museumApi";
import { restoreOrDiscardExpiredSession } from "../application/sessionRecovery";
import { eraSessionKey, type EraDefinition } from "./eraRegistry";

export interface EraSessionPorts {
  create: typeof createSession;
  restore: typeof restoreSession;
  enter: typeof enterGallery;
  unpair: typeof unpairSession;
}
const ports: EraSessionPorts = {
  create: createSession, restore: restoreSession, enter: enterGallery, unpair: unpairSession,
};

/** Prepare only the selected hall. No voice connection or device configuration is changed. */
export async function openEraSession(
  era: EraDefinition,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
  api: EraSessionPorts = ports,
): Promise<ActiveSession> {
  const key = eraSessionKey(era);
  let credentials: SessionCredentials | null = null;
  const saved = storage.getItem(key);
  if (saved) {
    try {
      const value = JSON.parse(saved) as SessionCredentials;
      if (value.pack_id === era.packId && value.version === era.version
        && typeof value.session_id === "string" && value.session_id
        && typeof value.session_token === "string" && value.session_token) credentials = value;
      else storage.removeItem(key);
    } catch { storage.removeItem(key); }
  }
  let active: ActiveSession | null = null;
  if (credentials) {
    const credential = credentials;
    active = (await restoreOrDiscardExpiredSession(
      () => api.restore(credential), () => storage.removeItem(key),
    )).session;
  }
  if (!active) {
    credentials = await api.create(era.packId, era.version);
    active = await api.restore(credentials);
  }
  try {
    if (active.pack_id !== era.packId || active.version !== era.version) {
      throw new Error("会话内容版本与所选朝代不一致，未进入展厅");
    }
    if (active.state.gallery_id !== era.galleryId || active.state.gallery_view?.page_size !== era.pageSize) {
      const entered = await api.enter(active, era.galleryId, era.pageSize);
      if (entered.receipt.status !== "committed") throw new Error(entered.receipt.reason ?? "展厅尚未开放");
      active = entered.session;
    }
    if (active.state.gallery_view?.page_size !== era.pageSize) throw new Error("服务端分页尚未准备好，未进入展厅");
    storage.setItem(key, JSON.stringify({
      session_id: active.session_id, session_token: active.session_token,
      pack_id: active.pack_id, version: active.version,
    } satisfies SessionCredentials));
    return active;
  } catch (error) {
    await api.unpair(active).catch(() => undefined);
    throw error;
  }
}

/** Bind voice at the candidate door without claiming a hall has opened. */
export async function openVoiceBinding(
  era: EraDefinition,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
  api: EraSessionPorts = ports,
): Promise<ActiveSession> {
  const key = eraSessionKey(era);
  let credentials: SessionCredentials | null = null;
  const saved = storage.getItem(key);
  if (saved) {
    try {
      const value = JSON.parse(saved) as SessionCredentials;
      if (value.pack_id === era.packId && value.version === era.version
        && typeof value.session_id === "string" && value.session_id
        && typeof value.session_token === "string" && value.session_token) credentials = value;
      else storage.removeItem(key);
    } catch { storage.removeItem(key); }
  }
  let active: ActiveSession | null = null;
  if (credentials) {
    const credential = credentials;
    active = (await restoreOrDiscardExpiredSession(
      () => api.restore(credential), () => storage.removeItem(key),
    )).session;
  }
  if (!active) {
    credentials = await api.create(era.packId, era.version);
    active = await api.restore(credentials);
  }
  if (active.pack_id !== era.packId || active.version !== era.version) {
    await api.unpair(active).catch(() => undefined);
    throw new Error("入口语音会话版本与当前唐代基线不一致，未绑定");
  }
  storage.setItem(key, JSON.stringify({
    session_id: active.session_id, session_token: active.session_token,
    pack_id: active.pack_id, version: active.version,
  } satisfies SessionCredentials));
  return active;
}

/** Ignore late target preparations; release their pairing without touching the displayed session. */
export class EraPreparation {
  private generation = 0;
  async prepare(
    era: EraDefinition,
    open: (era: EraDefinition) => Promise<ActiveSession> = openEraSession,
    release: (session: ActiveSession) => Promise<void> = unpairSession,
    pauseNarration?: () => void,
  ): Promise<ActiveSession | null> {
    pauseNarration?.();
    const generation = ++this.generation;
    const next = await open(era);
    if (generation !== this.generation) {
      await release(next).catch(() => undefined);
      return null;
    }
    return next;
  }
  cancel(): void { this.generation += 1; }
}
