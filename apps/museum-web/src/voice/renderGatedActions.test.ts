import { describe, expect, it } from "vitest";
import {
  CLOSE_UP_INTRO_ACTIONS,
  isCloseUpIntroAction,
  isOverviewWindowAction,
  isRenderGatedAction,
  OVERVIEW_WINDOW_ACTIONS,
  RENDER_GATED_ACTIONS,
} from "./renderGatedActions";

describe("render-gated action contract", () => {
  it("keeps browse_gallery and seek_time_range in the shared render-gated list", () => {
    expect([...RENDER_GATED_ACTIONS].sort()).toEqual([
      "browse_gallery",
      "locate_artifact",
      "move_next",
      "move_previous",
      "return_to_exhibit",
      "seek_time_range",
      "set_view",
    ]);
  });

  it("treats browse and time filter as overview window actions, not close-up intros", () => {
    expect(OVERVIEW_WINDOW_ACTIONS).toEqual(["browse_gallery", "seek_time_range"]);
    expect(isRenderGatedAction("browse_gallery")).toBe(true);
    expect(isRenderGatedAction("seek_time_range")).toBe(true);
    expect(isOverviewWindowAction("browse_gallery")).toBe(true);
    expect(isCloseUpIntroAction("browse_gallery")).toBe(false);
    expect(CLOSE_UP_INTRO_ACTIONS.every(isRenderGatedAction)).toBe(true);
  });
});
