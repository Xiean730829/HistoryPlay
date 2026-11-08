import { afterEach, describe, expect, it, vi } from "vitest";
import { enterGallery, loadGalleryDocument, type ActiveSession } from "./museumApi";

afterEach(() => vi.unstubAllGlobals());
const session = {
  session_id: "song-test", session_token: "test-only", connection_id: "song-connection", control_ticket: "test-ticket",
  pack_id: "cn.song.core", version: "0.1.0",
  state: { revision: 1, view_revision: 0, interaction_epoch: 0 }, context: {},
} as ActiveSession;

it("sends the three-item entry window in the same server command", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
    url.endsWith("/commands") ? { schema_version: "1", request_id: JSON.parse(String(init?.body)).request_id,
      session_id: session.session_id, status: "committed", action: "enter_gallery" }
      : url.endsWith("/context") ? session.context : { ...session.state, gallery_view: { page_size: 3, window_start: 0 } },
  ), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await enterGallery(session, "cn.song.gallery.main", 3);
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
    action: "enter_gallery", target_id: "cn.song.gallery.main", params: { page_size: 3 },
  });
  expect(result.session.state.gallery_view?.page_size).toBe(3);
});

describe("published scroll metadata", () => {
  it("reads metadata with the current session binding, without fetching images or models", async () => {
    const gallery = { id: "cn.song.gallery.main", stations: [], scrolls: [{ id: "cn.song.scroll.life" }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(gallery), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadGalleryDocument(session, gallery.id)).toEqual(gallery);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/sessions/song-test/galleries/cn.song.gallery.main");
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("X-Museum-Connection")).toBe("song-connection");
  });

  it("forwards abort so a stale gallery document cannot settle after leaving the hall", async () => {
    const gallery = { id: "cn.song.gallery.main", stations: [], scrolls: [{ id: "cn.song.scroll.life" }] };
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadGalleryDocument(session, gallery.id, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
