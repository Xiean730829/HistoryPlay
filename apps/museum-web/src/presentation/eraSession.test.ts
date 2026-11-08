import { describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { ApiRequestError } from "../application/museumApi";
import { eraRegistry, eraSessionKey } from "./eraRegistry";
import { EraPreparation, openEraSession, openVoiceBinding, type EraSessionPorts } from "./eraSession";

const song = eraRegistry.song;
function session(id = "session-song"): ActiveSession {
  return {
    session_id: id, session_token: "test-only", pack_id: song.packId, version: song.version,
    connection_id: "connection", control_ticket: "test-ticket",
    state: { gallery_id: song.galleryId, gallery_view: { page_size: 3 } },
  } as unknown as ActiveSession;
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function api(active = session()): EraSessionPorts {
  return { create: vi.fn().mockResolvedValue(active), restore: vi.fn().mockResolvedValue(active),
    enter: vi.fn().mockResolvedValue({ session: active, receipt: { status: "committed" } }),
    unpair: vi.fn().mockResolvedValue(undefined) };
}

describe("selected era session", () => {
  it("creates only the selected pack and isolates storage by version", async () => {
    const store = storage(); const ports = api();
    await openEraSession(song, store, ports);
    expect(ports.create).toHaveBeenCalledWith("cn.song.core", song.version);
    expect(store.getItem(eraSessionKey(song))).toContain("session-song");
    expect(store.getItem(eraSessionKey(eraRegistry.tang))).toBeNull();
  });
  it("rejects mismatched saved credentials before restoration", async () => {
    const store = storage(); const ports = api();
    store.setItem(eraSessionKey(song), JSON.stringify({ ...session(), pack_id: "cn.tang.core" }));
    await openEraSession(song, store, ports);
    expect(ports.create).toHaveBeenCalledTimes(1);
    expect(ports.restore).toHaveBeenCalledTimes(1);
  });
  it("initializes the server window before presenting Song", async () => {
    const ports = api();
    vi.mocked(ports.restore).mockResolvedValue({ ...session(), state: { gallery_id: null } } as unknown as ActiveSession);
    await openEraSession(song, storage(), ports);
    expect(ports.enter).toHaveBeenCalledWith(expect.anything(), song.galleryId, 3);
  });
  it("does not claim success or save a rejected gallery", async () => {
    const ports = api(); const store = storage();
    vi.mocked(ports.restore).mockResolvedValue({ ...session(), state: {} } as ActiveSession);
    vi.mocked(ports.enter).mockResolvedValue({ session: session(), receipt: { status: "rejected", reason: "not open" } } as never);
    await expect(openEraSession(song, store, ports)).rejects.toThrow("not open");
    expect(store.getItem(eraSessionKey(song))).toBeNull();
    expect(ports.unpair).toHaveBeenCalledTimes(1);
  });
  it("keeps valid credentials on a binding failure rather than silently replacing them", async () => {
    const ports = api(); const store = storage();
    store.setItem(eraSessionKey(song), JSON.stringify(session()));
    vi.mocked(ports.restore).mockRejectedValue(new ApiRequestError(403, "binding denied"));
    await expect(openEraSession(song, store, ports)).rejects.toThrow("binding denied");
    expect(ports.create).not.toHaveBeenCalled();
    expect(store.getItem(eraSessionKey(song))).not.toBeNull();
  });
  it("discards an expired credential and opens the same selected era", async () => {
    const ports = api(); const store = storage();
    store.setItem(eraSessionKey(song), JSON.stringify(session()));
    vi.mocked(ports.restore).mockRejectedValueOnce(new ApiRequestError(401, "expired"));
    expect(await openEraSession(song, store, ports)).toEqual(session());
    expect(ports.create).toHaveBeenCalledWith(song.packId, song.version);
  });
  it("releases a late preparation after cancellation", async () => {
    const gate = new EraPreparation(); let finish!: (value: ActiveSession) => void;
    const release = vi.fn().mockResolvedValue(undefined);
    const pending = gate.prepare(song, () => new Promise((resolve) => { finish = resolve; }), release);
    gate.cancel(); finish(session());
    expect(await pending).toBeNull();
    expect(release).toHaveBeenCalledWith(session());
  });
  it("pauses old narration before opening the target hall", async () => {
    const gate = new EraPreparation();
    const pause = vi.fn();
    await gate.prepare(song, async () => session(), async () => undefined, pause);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("binds door voice without entering a gallery", async () => {
    const tang = eraRegistry.tang;
    const door = {
      ...session("session-door"), pack_id: tang.packId, version: tang.version, state: {},
    } as unknown as ActiveSession;
    const ports = api(door);
    const store = storage();
    const bound = await openVoiceBinding(tang, store, ports);
    expect(ports.create).toHaveBeenCalledWith(tang.packId, tang.version);
    expect(ports.enter).not.toHaveBeenCalled();
    expect(bound.session_id).toBe("session-door");
  });
});
