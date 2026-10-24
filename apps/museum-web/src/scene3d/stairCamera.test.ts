import { describe, expect, it } from "vitest";
import { stationPlacement } from "./layout";
import { stairCameraPose, stairRouteHeight, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./stairCamera";

describe("ascending museum route", () => {
  it("starts low in the center and advances upward to later artifacts", () => {
    const start = stairCameraPose(0, false);
    expect(start.position).toEqual([0, VISITOR_EYE_HEIGHT, 9.5]);
    expect(start.lookAt[1]).toBeGreaterThan(start.position[1]);
    const first = stairCameraPose(0, true);
    const last = stairCameraPose(2, true);
    expect(last.position[2]).toBeLessThan(first.position[2]);
    expect(last.position[1]).toBeGreaterThan(first.position[1]);
  });
  it("keeps the observing eye above the shared route and restores the same target deterministically", () => {
    for (let i = 0; i < 3; i++) {
      const pose = stairCameraPose(i, true, 1.4);
      expect(pose.position[1] - stairRouteHeight(pose.position[2])).toBeCloseTo(VISITOR_EYE_HEIGHT);
      expect(pose.lookAt[1]).toBeGreaterThan(stationPlacement(i).plinthTop);
      expect(stairCameraPose(i, true, 1.4)).toEqual(pose);
    }
    expect(stationFacingYaw(0)).toBeGreaterThan(0);
    expect(stationFacingYaw(1)).toBeLessThan(0);
  });
});
