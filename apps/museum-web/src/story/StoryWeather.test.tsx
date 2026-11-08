import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StoryWeather, storyWeather } from "./StoryWeather";

describe("Song story weather", () => {
  it("selects weather only for the intended pack, scene and image", () => {
    expect(storyWeather("cn.song.core", "cn.song.node.snowy-riverbank.02", "cn.song.asset.snowy-riverbank.story-02")).toBe("snow");
    expect(storyWeather("cn.song.core", "cn.song.node.sheng-sheng-man.02", "cn.song.asset.sheng-sheng-man.story-02")).toBe("rain");
    expect(storyWeather("cn.tang.core", "cn.song.node.snowy-riverbank.02", "cn.song.asset.snowy-riverbank.story-02")).toBeNull();
    expect(storyWeather("cn.song.core", "cn.song.node.snowy-riverbank.03", "cn.song.asset.snowy-riverbank.story-03")).toBe("snow");
    expect(storyWeather("cn.song.core", "cn.song.node.snowy-riverbank.01", "cn.song.asset.snowy-riverbank.story-02")).toBeNull();
    expect(storyWeather("cn.song.core", "cn.song.node.sheng-sheng-man.02", "replacement-image")).toBeNull();
  });

  it("renders bounded, decorative particles and clips rain to the window", () => {
    const snow = renderToStaticMarkup(<StoryWeather weather="snow" />);
    const rain = renderToStaticMarkup(<StoryWeather weather="rain" />);
    expect(snow.match(/<circle /g)).toHaveLength(94);
    expect(rain.match(/<line /g)).toHaveLength(132);
    expect(snow).toContain("radialGradient");
    expect(rain).toContain("linearGradient");
    expect(rain).toContain('aria-hidden="true"');
    expect(rain).toContain('x="475" y="125" width="950" height="570"');
    expect(rain).toContain("clip-path=");
  });
});
