import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SongAtmosphere, scrollAtmosphere, storyAtmosphere } from "./SongAtmosphere";

describe("illustration-specific Song atmosphere", () => {
  it("covers the twelve known scrolls, only when the image and pack match", () => {
    for (const id of ["life", "landscape", "poetry", "craft", "city", "gathering", "bianjing-lanterns", "mountains-into-painting", "literati-travel", "poetic-rivers", "investigation-making", "turning-rivers"]) {
      expect(scrollAtmosphere("cn.song.core", `cn.song.scroll.${id}`, `cn.song.asset.scroll.${id}`).length).toBeGreaterThan(0);
    }
    expect(scrollAtmosphere("cn.tang.core", "cn.song.scroll.life", "cn.song.asset.scroll.life")).toEqual([]);
    expect(scrollAtmosphere("cn.song.core", "cn.song.scroll.life", "other")).toEqual([]);
    expect(scrollAtmosphere("cn.song.core", "cn.song.scroll.bianjing-lanterns", "cn.song.asset.scroll.bianjing-lanterns", "0.1.4"))
      .not.toEqual(scrollAtmosphere("cn.song.core", "cn.song.scroll.bianjing-lanterns", "cn.song.asset.scroll.bianjing-lanterns", "0.1.3"));
  });
  it("adds atmosphere to at least one scene of each of the new eighteen stories", () => {
    const ids = ["qingming-riverside", "jiaozi", "dongjing-menghua", "thousand-li-rivers-mountains", "fan-kuan-travelers", "listening-qin", "hanshi-scroll", "zuiweng-pavilion", "later-red-cliff", "summer-quatrain", "shier", "passing-lingding", "movable-type", "ru-celadon-dish", "water-astronomical-clock", "jingkang-change", "yancheng-battle", "yashan-battle"];
    for (const id of ids) {
      expect(["01", "02", "03"].some(n => storyAtmosphere("cn.song.core", `cn.song.node.${id}.${n}`, `cn.song.asset.${id}.story-${n}`).length)).toBe(true);
    }
  });
  it("limits story cues to their exact current node and image", () => {
    const node = "cn.song.node.bronze-censer.01";
    const asset = "cn.song.asset.bronze-censer.story-01";
    expect(storyAtmosphere("cn.song.core", node, asset)[0]?.kind).toBe("smoke");
    expect(storyAtmosphere("cn.song.core", node, "cn.song.asset.bronze-censer.story-02")).toEqual([]);
    expect(storyAtmosphere("cn.tang.core", node, asset)).toEqual([]);
    expect(storyAtmosphere("cn.song.core", "cn.song.node.ding-vase.03", "cn.song.asset.ding-vase.story-03")).toEqual([]);
  });
  it("renders an inaccessible, non-interactive decoration rather than a control", () => {
    const cues = scrollAtmosphere("cn.song.core", "cn.song.scroll.life", "cn.song.asset.scroll.life");
    const html = renderToStaticMarkup(<SongAtmosphere cues={cues} scroll />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).not.toContain("button");
  });
});
