import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActiveSession, ArtifactProjection, GalleryDocument } from "../application/museumApi";
import {
  artifactDateLabel, nextStoryNodeId, songExhibitMediaPlan, songHotspotBindings,
  songScrollKeyboardIntent, songScrollWindow, validSongHotspot,
} from "./songScrollLayout";
import { SongScrollGallery } from "./SongScrollGallery";
import { SongExhibitPage } from "./SongExhibitPage";

const artifacts = Array.from({ length: 18 }, (_, i) => ({
  id: `cn.song.artifact.a${i}`, title: `展品${i}`, category: "器物", material: "瓷",
  museum: { name: "测试馆", accession: `${i}` },
  time_range: { start_year: 1000, end_year: 1099, precision: "century" },
  asset_ids: [], story_entry_ids: [],
}) as ArtifactProjection);
const gallery: GalleryDocument = {
  id: "cn.song.gallery.main", title: "宋代", status: "open",
  stations: artifacts.map((artifact, order) => ({ artifact, order, id: `station-${order}` })),
  scrolls: Array.from({ length: 6 }, (_, i) => ({ id: `scroll-${i}`, title: `第${i + 1}卷`, theme: "life",
    background_asset_id: `background-${i}`, interpretation_label: "艺术演绎，不是馆藏照片",
    station_ids: Array.from({ length: 3 }, (_, j) => `station-${i * 3 + j}`),
    hotspots: Array.from({ length: 3 }, (_, j) => ({
      station_id: `station-${i * 3 + j}`, label: artifacts[i * 3 + j]!.title,
      x: 0.05 + j * 0.3, y: 0.2, width: 0.22, height: 0.4,
    })),
  })),
};
function session(start = 0): ActiveSession {
  return { session_id: "s", session_token: "test", pack_id: "cn.song.core", version: "0.1.0",
    state: { gallery_id: gallery.id, gallery_view: { page_size: 3, window_start: start },
      display_order: artifacts.map((item) => item.id) } } as unknown as ActiveSession;
}

describe("authoritative Song scroll projection", () => {
  it.each([0, 3, 6, 9, 12, 15])("projects server window %i without a local page counter", (start) => {
    const view = songScrollWindow(session(start), gallery);
    expect(view?.stations.map((item) => item.artifact.id)).toEqual(artifacts.slice(start, start + 3).map((item) => item.id));
    expect(view?.scroll?.id).toBe(`scroll-${start / 3}`);
  });
  it("refuses a four-item or foreign gallery projection", () => {
    const active = session();
    active.state.gallery_view!.page_size = 4;
    expect(songScrollWindow(active, gallery)).toBeNull();
    expect(songScrollWindow(session(), { ...gallery, id: "foreign" })).toBeNull();
  });
  it("shows mixed-scroll filtered names without assigning the wrong painting", () => {
    const active = session(); active.state.display_order = [artifacts[0]!.id, artifacts[4]!.id];
    expect(songScrollWindow(active, gallery)?.scroll).toBeNull();
  });
  it("retains a truthful unknown date rather than substituting the Song era", () => {
    expect(artifactDateLabel({ start_year: 960, end_year: 1279, precision: "unknown" })).toBe("时间不详");
  });
  it("rejects overflow and non-finite hotspots", () => {
    const valid = { station_id: "s", x: .1, y: .2, width: .3, height: .4, label: "器物" };
    expect(validSongHotspot(valid)).toBe(true);
    expect(validSongHotspot({ ...valid, width: 1 })).toBe(false);
    expect(validSongHotspot({ ...valid, x: NaN })).toBe(false);
  });
  it("renders only the current three names and no image/GLB before acquisition", () => {
    const html = renderToStaticMarkup(<SongScrollGallery session={session()} gallery={gallery} busy={false} onSelect={() => {}} />);
    expect(html).toContain("展品0"); expect(html).toContain("展品2");
    expect(html).not.toContain("展品3"); expect(html).not.toContain("<img"); expect(html).not.toContain("model-viewer");
    expect(html).toContain('data-scroll-id="scroll-0"');
  });
  it("pairs each visible hotspot with the same-named caption and the same artifact id", () => {
    const view = songScrollWindow(session(3), gallery);
    const bindings = songHotspotBindings(view!.stations, view!.scroll!.hotspots);
    expect(bindings.map((item) => [item.hotspot?.label, item.name, item.artifactId])).toEqual([
      ["展品3", "展品3", "cn.song.artifact.a3"],
      ["展品4", "展品4", "cn.song.artifact.a4"],
      ["展品5", "展品5", "cn.song.artifact.a5"],
    ]);
  });
  it("does not invent names or hotspots for an incomplete assembled window", () => {
    const one: GalleryDocument = {
      ...gallery,
      stations: [gallery.stations[0]!],
      scrolls: [{ ...gallery.scrolls![0]!, station_ids: ["station-0"], hotspots: [gallery.scrolls![0]!.hotspots[0]!] }],
    };
    const active = session();
    active.state.display_order = [artifacts[0]!.id];
    const view = songScrollWindow(active, one);
    expect(view?.stations).toHaveLength(1);
    expect(songHotspotBindings(view!.stations, view!.scroll!.hotspots)).toHaveLength(1);
    const html = renderToStaticMarkup(<SongScrollGallery session={active} gallery={one} busy={false} onSelect={() => {}} />);
    expect(html).toContain("展品0");
    expect(html).not.toContain("展品1");
  });
  it("moves keyboard focus among the current three names without a local page counter", () => {
    expect(songScrollKeyboardIntent("ArrowRight", 3, 0)).toEqual({ kind: "focus", index: 1 });
    expect(songScrollKeyboardIntent("ArrowLeft", 3, 0)).toEqual({ kind: "focus", index: 0 });
    expect(songScrollKeyboardIntent("End", 3, 0)).toEqual({ kind: "focus", index: 2 });
    expect(songScrollKeyboardIntent("2", 3, 0)).toEqual({ kind: "select", index: 1 });
    expect(songScrollKeyboardIntent("Enter", 3, 2)).toBeNull();
    expect(songScrollKeyboardIntent("ArrowRight", 1, 0)).toEqual({ kind: "focus", index: 0 });
    expect(songScrollKeyboardIntent("4", 3, 0)).toBeNull();
  });
  it("keeps the six-scroll server windows at 0,3,6,9,12,15 and refuses a seventh", () => {
    expect([0, 3, 6, 9, 12, 15].map((start) => songScrollWindow(session(start), gallery)?.scroll?.id))
      .toEqual(["scroll-0", "scroll-1", "scroll-2", "scroll-3", "scroll-4", "scroll-5"]);
    expect(songScrollWindow(session(18), gallery)).toBeNull();
  });
  it("projects twelve authored scrolls of three without mixing a later window into an earlier scroll", () => {
    const thirtySix = Array.from({ length: 36 }, (_, i) => ({
      id: `cn.song.artifact.a${i}`, title: `展品${i}`, category: "器物", material: "瓷",
      museum: { name: "测试馆", accession: `${i}` },
      time_range: { start_year: 1000, end_year: 1099, precision: "century" },
      asset_ids: [], story_entry_ids: i >= 18 ? [`cn.song.story.a${i}`] : [],
    }) as ArtifactProjection);
    const twelve: GalleryDocument = {
      id: "cn.song.gallery.main", title: "宋代", status: "open",
      stations: thirtySix.map((artifact, order) => ({ artifact, order, id: `station-${order}` })),
      scrolls: Array.from({ length: 12 }, (_, i) => ({
        id: `scroll-${i}`, title: `第${i + 1}卷`, theme: "life",
        background_asset_id: `background-${i}`, interpretation_label: "艺术演绎，不是馆藏照片",
        station_ids: Array.from({ length: 3 }, (_, j) => `station-${i * 3 + j}`),
        hotspots: Array.from({ length: 3 }, (_, j) => ({
          station_id: `station-${i * 3 + j}`, label: thirtySix[i * 3 + j]!.title,
          x: 0.05 + j * 0.3, y: 0.2, width: 0.22, height: 0.4,
        })),
      })),
    };
    const active = (start: number): ActiveSession => ({
      session_id: "s", session_token: "test", pack_id: "cn.song.core", version: "0.1.1",
      state: {
        gallery_id: twelve.id, gallery_view: { page_size: 3, window_start: start },
        display_order: thirtySix.map((item) => item.id),
      },
    } as unknown as ActiveSession);
    const starts = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33];
    expect(starts.map((start) => songScrollWindow(active(start), twelve)?.scroll?.id))
      .toEqual(starts.map((_, i) => `scroll-${i}`));
    const seventh = songScrollWindow(active(18), twelve);
    expect(seventh?.stations.map((item) => item.artifact.id)).toEqual([
      "cn.song.artifact.a18", "cn.song.artifact.a19", "cn.song.artifact.a20",
    ]);
    expect(seventh?.scroll?.id).toBe("scroll-6");
    expect(songHotspotBindings(seventh!.stations, seventh!.scroll!.hotspots).map((item) => item.name))
      .toEqual(["展品18", "展品19", "展品20"]);
    expect(songScrollWindow(active(36), twelve)).toBeNull();
  });
  it("plans model and photo together and never uses story asset_ids as original photos", () => {
    const withStoryIds = {
      ...artifacts[0]!,
      asset_ids: ["cn.song.asset.story.01"],
      presentation: {
        preview_asset_id: "cn.song.asset.photo",
        display: { kind: "model3d", asset_id: "cn.song.asset.model" },
        teaser: "x",
        background_node_id: "n",
      },
    } as ArtifactProjection;
    expect(songExhibitMediaPlan(withStoryIds, false)).toMatchObject({
      modelAssetId: "cn.song.asset.model", photoAssetId: "cn.song.asset.photo", showModel: true,
    });
    expect(songExhibitMediaPlan(withStoryIds, true)).toMatchObject({
      modelAssetId: null, photoAssetId: "cn.song.asset.photo", photoKind: "preview_fallback", showModel: false,
    });
    expect(songExhibitMediaPlan({ ...artifacts[0]!, asset_ids: ["cn.song.asset.story.01"] } as ArtifactProjection, false).problem)
      .toContain("没有用画卷或故事图冒充实物");
  });
  it("reads the next authored story node id from continue_story, not from a local counter", () => {
    expect(nextStoryNodeId({
      available_exits: [{ action: "continue_story", target_node_id: "cn.song.node.qingbai-ewer.02" }],
    })).toBe("cn.song.node.qingbai-ewer.02");
    expect(nextStoryNodeId({ available_exits: [{ action: "choose_route", target_node_id: "other" }] })).toBeNull();
  });
  it("uses an independent article page and explicitly gates the unapproved story", () => {
    const html = renderToStaticMarkup(<SongExhibitPage artifact={artifacts[0]!} session={session()} busy={false}
      onReturn={() => {}} onStory={() => {}} onRender={() => {}} />);
    expect(html).toContain("<article"); expect(html).not.toContain("dialog");
    expect(html).toContain("返回同一画卷"); expect(html).toContain("故事制作中");
    expect(html).not.toContain("听这件展品的故事");
  });
  it("labels an interpretive poem without pretending it is a handwriting photograph", () => {
    const poem = {
      ...artifacts[0]!,
      exhibit_type: "poem",
      identity: undefined,
      museum: undefined,
      presentation: {
        preview_asset_id: "cn.song.asset.poem.preview",
        display: {
          kind: "interpretive_image",
          asset_id: "cn.song.asset.poem.interpretive",
          interpretation_label: "艺术演绎，非手迹、非真实肖像",
        },
        printed_text: {
          body: "明月几时有？把酒问青天。",
          script_status: "printed_not_handwriting",
          source_label: "公共领域原作现代排印",
        },
        teaser: "未核实手迹。",
        background_node_id: "cn.song.node.poem.01",
      },
    } as ArtifactProjection;
    const html = renderToStaticMarkup(<SongExhibitPage artifact={poem} session={session()} busy={false}
      onReturn={() => {}} onStory={() => {}} onRender={() => {}} />);
    expect(html).toContain("艺术演绎，非手迹、非真实肖像");
    expect(html).toContain("明月几时有");
    expect(html).not.toContain("馆藏图片");
    expect(html).not.toContain("听这件展品的故事");
  });
  it("keeps original photographs complete rather than cover-cropping the subject", async () => {
    const nodeFs = "node:fs";
    const { readFileSync } = await import(nodeFs) as { readFileSync: (url: URL, encoding: string) => string };
    const css = readFileSync(new URL("./songScroll.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.song-scroll-paper > img[\s\S]*object-fit:\s*contain/);
    expect(css).toMatch(/\.song-exhibit-media img[\s\S]*object-fit:\s*contain/);
    expect(css).not.toMatch(/\.song-scroll-paper > img[\s\S]*object-fit:\s*cover/);
    expect(css).not.toMatch(/\.song-exhibit-media img[\s\S]*object-fit:\s*cover/);
  });
  it("keeps the independent page as an article even when a same-object model is planned", () => {
    const modeled = {
      ...artifacts[0]!,
      presentation: {
        preview_asset_id: "cn.song.asset.photo",
        display: { kind: "model3d", asset_id: "cn.song.asset.model" },
        teaser: "有同件模型。",
        background_node_id: "n",
      },
    } as ArtifactProjection;
    const html = renderToStaticMarkup(<SongExhibitPage artifact={modeled} session={session()} busy={false}
      onReturn={() => {}} onStory={() => {}} onRender={() => {}} />);
    expect(html).toContain("<article");
    expect(html).not.toContain("dialog");
    expect(html).not.toContain("模型不可用");
    expect(html).toContain("正在按需读取本件展品素材");
  });
});
