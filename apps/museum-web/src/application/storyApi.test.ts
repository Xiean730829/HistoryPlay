import { afterEach, describe, expect, it, vi } from "vitest";
import { enterStory, readStoryNode, returnToExhibit, type ActiveSession } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());

function session(): ActiveSession {
  return {
    session_id: "session-1",
    session_token: "session-secret",
    pack_id: "cn.tang.core",
    version: "0.2.1",
    connection_id: "connection-1",
    control_ticket: "ticket-12345678",
    state: {
      session_id: "session-1", revision: 7, view_revision: 4, interaction_epoch: 3,
      event_seq: 6, mode: "explore", display_order: ["stele"],
    },
    context: {
      session_id: "session-1", revision: 7, event_seq: 6, mode: "explore",
      focused_artifact: { id: "stele", title: "造像碑", story_entry_ids: ["story-1"] },
      visible_artifacts: [], story_node: null,
    },
  } as unknown as ActiveSession;
}

describe("story APIs", () => {
  it("reads only a requested node in the pinned version using the paired session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content_id: "node-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await readStoryNode(session(), "node-1", new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sessions/session-1/content?pack_id=cn.tang.core&version=0.2.1&content_id=node-1&limit=1");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer session-secret");
    expect(new Headers(init.headers).get("X-Museum-Connection")).toBe("connection-1");
  });

  it("enters and exits story only through versioned server commands", async () => {
    const base = session();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/commands")) {
        const command = JSON.parse(String(init?.body)) as { request_id: string; action: string };
        return new Response(JSON.stringify({
          schema_version: "1", receipt_id: `receipt-${command.action}`, request_id: command.request_id,
          session_id: base.session_id, status: "committed", revision: 8,
          interaction_epoch: 4, action: command.action,
        }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        return new Response(JSON.stringify({ ...base.context, revision: 8, event_seq: 7 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...base.state, revision: 8, event_seq: 7 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const entered = await enterStory(base, "story-1");
    const entryCommand = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/commands"));
    expect(JSON.parse(String(entryCommand?.[1]?.body))).toMatchObject({
      action: "enter_story", target_id: "story-1", expected_revision: 7,
      expected_view_revision: 4, interaction_epoch: 3,
    });
    expect(entered.receipt.status).toBe("committed");

    const exiting = await returnToExhibit(entered.session);
    const commands = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/commands"));
    expect(JSON.parse(String(commands[1]?.[1]?.body))).toMatchObject({
      action: "return_to_exhibit", expected_view_revision: 4,
    });
    expect(exiting.receipt.action).toBe("return_to_exhibit");
  });
});
