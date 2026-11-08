import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { kilnSmokeForScroll, SongKilnSmoke } from "./SongKilnSmoke";

describe("craft scroll smoke", () => {
  it("appears only for the intended Song scroll and illustration", () => {
    expect(kilnSmokeForScroll("cn.song.core", "cn.song.scroll.craft", "cn.song.asset.scroll.craft")).toBe(true);
    expect(kilnSmokeForScroll("cn.tang.core", "cn.song.scroll.craft", "cn.song.asset.scroll.craft")).toBe(false);
    expect(kilnSmokeForScroll("cn.song.core", "cn.song.scroll.life", "cn.song.asset.scroll.craft")).toBe(false);
    expect(kilnSmokeForScroll("cn.song.core", "cn.song.scroll.craft", "another-image")).toBe(false);
  });
  it("renders three bounded, decorative smoke sources", () => {
    const html = renderToStaticMarkup(<SongKilnSmoke />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 2066 761"');
    expect(html.match(/<ellipse /g)).toHaveLength(36);
  });
});
