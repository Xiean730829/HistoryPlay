import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "./museumApi";
import { reportRenderReceipt } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());

describe("reportRenderReceipt", () => {
  it("sends frame evidence with the session binding and exact command identity", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const session = {
      session_id: "session/one",
      session_token: "secret-token",
      connection_id: "connection-1",
    } as ActiveSession;
    const receipt = {
      request_id: "request-1",
      payload_digest: "sha256:abc",
      revision: 7,
      view_revision: 3,
      interaction_epoch: 2,
      status: "degraded" as const,
      reason: "模型未能显示，使用真实预览图",
    };

    await reportRenderReceipt(session, receipt);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/session%2Fone/render-receipts");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-token");
    expect(new Headers(init?.headers).get("X-Museum-Connection")).toBe("connection-1");
    expect(JSON.parse(String(init?.body))).toEqual(receipt);
  });
});
