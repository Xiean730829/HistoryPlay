import { describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { SessionProjectionStore } from "./sessionProjection";

function session(eventSeq: number, revision = eventSeq): ActiveSession {
  return {
    session_id: "session-1",
    session_token: "secret",
    pack_id: "cn.tang.core",
    version: "1.0.0",
    connection_id: "connection-1",
    control_ticket: "control",
    context: { session_id: "session-1", revision, event_seq: eventSeq, mode: "explore", focused_artifact: null,
      visible_artifacts: [], story_node: null },
    state: { session_id: "session-1", revision, event_seq: eventSeq, view_revision: revision,
      interaction_epoch: revision, display_order: [], mode: "explore", schema_version: "1", pack_versions: {} },
  } as ActiveSession;
}

describe("SessionProjectionStore", () => {
  it("ignores duplicate events and refreshes the authoritative query once", async () => {
    const load = vi.fn(async () => session(1));
    const store = new SessionProjectionStore(session(0), load);
    const event = { session_id: "session-1", event_seq: 1, kind: "artifact_opened", revision: 1, interaction_epoch: 1 };

    await store.receiveEvent(event);
    await store.receiveEvent(event);

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.snapshot.state.event_seq).toBe(1);
  });

  it("recovers gaps from a server query instead of applying partial events", async () => {
    const load = vi.fn(async () => session(4));
    const store = new SessionProjectionStore(session(1), load);

    await store.receiveEvent({ session_id: "session-1", event_seq: 3, kind: "focus_changed", revision: 3, interaction_epoch: 1 });

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.snapshot.state.event_seq).toBe(4);
  });

  it("rejects an old snapshot that arrives after a newer event query", async () => {
    let resolveLoad!: (value: ActiveSession) => void;
    const load = vi.fn(() => new Promise<ActiveSession>((resolve) => { resolveLoad = resolve; }));
    const store = new SessionProjectionStore(session(0), load);
    const pending = store.receiveEvent({ session_id: "session-1", event_seq: 1, kind: "focus_changed", revision: 1, interaction_epoch: 1 });

    expect(await store.acceptQuery(session(0))).toBe(false);
    resolveLoad(session(1));
    await pending;

    expect(store.snapshot.state.event_seq).toBe(1);
  });
});
