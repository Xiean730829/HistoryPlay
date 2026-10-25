import { describe, expect, it } from "vitest";
import { stationPlacement } from "./layout";
import { routeCameraPose, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./routeCamera";

describe("particle-river camera route", () => {
  it("keeps one eye height and moves forward smoothly with each focused station", () => {
    const first = routeCameraPose(0, false);
    const last = routeCameraPose(2, false);
    expect(first.position).toEqual([0, VISITOR_EYE_HEIGHT, 10]);
    expect(last.position[1]).toBe(VISITOR_EYE_HEIGHT);
    expect(last.position[2]).toBeLessThan(first.position[2]);
    expect(last.lookAt[1]).toBe(first.lookAt[1]);
  });

  it("moves beside the focused case without coupling its camera to object rotation", () => {
    const p = stationPlacement(1);
    const pose = routeCameraPose(1, true, 1.4);
    expect(pose.position[1]).toBe(VISITOR_EYE_HEIGHT);
    expect(Math.abs(pose.position[0])).toBeLessThan(Math.abs(p.x));
    expect(pose.position[2]).toBe(p.z);
    expect(pose.lookAt).toEqual([p.x, p.plinthTop + 1.25, p.z]);
    expect(routeCameraPose(1, true, 1.4)).toEqual(pose);
  });

  it("keeps the display fronts aimed toward the central river", () => {
    expect(stationFacingYaw(0)).toBeGreaterThan(0);
    expect(stationFacingYaw(1)).toBeLessThan(0);
  });
});
