import { afterEach, describe, expect, it, vi } from "vitest";
import { moveGalleryStation, type ActiveSession } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());

describe("moveGalleryStation", () => {
  it.each([
    ["next", "move_next"],
    ["previous", "move_previous"],
  ] as const)("sends %s as an authoritative server command", async (direction, action) => {
    const session = {
      session_id: "session-1",
      session_token: "secret-token",
      pack_id: "cn.tang.core",
      version: "0.2.1",
      connection_id: "connection-1",
      control_ticket: "ticket-12345678",
      state: {
        session_id: "session-1",
        revision: 7,
        view_revision: 4,
        interaction_epoch: 3,
        event_seq: 6,
        mode: "explore",
        display_order: ["stele", "coin", "bull"],
      },
      context: {
        session_id: "session-1",
        revision: 7,
        event_seq: 6,
        mode: "explore",
        focused_artifact: { id: "stele", title: "造像碑" },
        visible_artifacts: [],
        story_node: null,
      },
    } as unknown as ActiveSession;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/commands")) {
        return new Response(JSON.stringify({
          schema_version: "1",
          receipt_id: "receipt-1",
          request_id: JSON.parse(String(init?.body)).request_id,
          session_id: "session-1",
          status: "committed",
          revision: 8,
          interaction_epoch: 4,
          action,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({
          ...session.context,
          revision: 8,
          event_seq: 7,
          focused_artifact: { id: direction === "next" ? "coin" : "stele", title: "焦点文物" },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ ...session.state, revision: 8, event_seq: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moveGalleryStation(session, direction);

    const command = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/commands"));
    expect(command).toBeDefined();
    const [url, init] = command!;
    expect(url).toBe("/api/sessions/session-1/commands");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expected_revision: 7,
      expected_view_revision: 4,
      interaction_epoch: 3,
      control_ticket: "ticket-12345678",
      action,
    });
    expect(new Headers(init?.headers).get("X-Museum-Connection")).toBe("connection-1");
    expect(result.receipt.status).toBe("committed");
    expect(result.session.context.focused_artifact?.id).toBe(direction === "next" ? "coin" : "stele");
  });
});
