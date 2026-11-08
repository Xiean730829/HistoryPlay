import { describe, expect, it } from "vitest";
import { artifactDateLabel, songScrollWindow, validSongHotspot } from "./songScrollLayout";
import type { ActiveSession, GalleryDocument } from "../application/museumApi";

describe("Song scroll projection", () => {
  it("preserves the server's three-item window and matches its authored scroll", () => {
    const stations = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, order: i, artifact: { id: `a${i}` } }));
    const gallery = { id: "g", stations, scrolls: [{ id: "second", station_ids: ["s3", "s4", "s5"] }] } as unknown as GalleryDocument;
    const session = { state: { gallery_id: "g", gallery_view: { page_size: 3, window_start: 3 }, display_order: stations.map(s => s.artifact.id) } } as unknown as ActiveSession;
    expect(songScrollWindow(session, gallery)?.scroll?.id).toBe("second");
    expect(songScrollWindow(session, gallery)?.stations.map(s => s.artifact.id)).toEqual(["a3", "a4", "a5"]);
  });
  it("rejects overflowing hotspots", () => {
    expect(validSongHotspot({ station_id: "s", label: "展品", x: .8, y: .2, width: .3, height: .4 })).toBe(false);
  });
  it("does not invent a date for an undated exhibit", () => {
    expect(artifactDateLabel({ start_year: 960, end_year: 1279, precision: "unknown" })).toBe("时间不详");
  });
});
