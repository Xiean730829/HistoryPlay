import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGalleryArtifacts, type ActiveSession } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());

describe("loadGalleryArtifacts", () => {
  it("uses the authenticated server route order, including not-yet-opened stations", async () => {
    const artifacts = [
      { id: "cn.tang.artifact.stele", title: "造像碑" },
      { id: "cn.tang.artifact.coin", title: "开元通宝" },
      { id: "cn.tang.artifact.bull", title: "鎏金卧牛" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      stations: artifacts.map((artifact) => ({ artifact })),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const session = {
      session_id: "session-1",
      session_token: "secret-token",
      pack_id: "cn.tang.core",
      version: "0.2.1",
      state: { gallery_id: "cn.tang.gallery.main" },
      connection_id: "connection-1",
      control_ticket: "ticket-12345678",
      context: {},
    } as ActiveSession;

    const result = await loadGalleryArtifacts(session, "cn.tang.gallery.main");

    expect(result.map(({ id }) => id)).toEqual(artifacts.map(({ id }) => id));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/galleries/cn.tang.gallery.main",
      expect.objectContaining({ headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
        "X-Museum-Connection": "connection-1",
      } }),
    );
  });

  it("403 绑定失效时明确提示，不当作文物没有资料", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "展台连接未绑定或已被新的配对替代",
      { status: 403 },
    )));
    const session = {
      session_id: "session-1",
      session_token: "secret-token",
      pack_id: "cn.tang.core",
      version: "0.3.3",
      state: { gallery_id: "cn.tang.gallery.main" },
      connection_id: "stale-connection",
      control_ticket: "ticket-12345678",
      context: {},
    } as ActiveSession;
    await expect(loadGalleryArtifacts(session, "cn.tang.gallery.main"))
      .rejects.toThrow("展台绑定已失效，请在当前页面重新开启语音后再试。这不是文物缺少资料。");
  });
});
