import { describe, expect, it } from "vitest";
import { stationPlacement } from "./layout";
import { routeCameraPose, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./routeCamera";
import { riverPointAt } from "./riverPath";

describe("galaxy-river camera route", () => {
  it("keeps one eye height and follows the S-curve tangent with each focused station", () => {
    const first = routeCameraPose(0, false);
    const last = routeCameraPose(2, false);
    const firstPathPoint = riverPointAt(-8);
    expect(first.position[0]).toBeCloseTo(firstPathPoint.x);
    expect(first.position[2]).toBeCloseTo(firstPathPoint.z);
    expect(last.position[1]).toBe(VISITOR_EYE_HEIGHT);
    expect(last.position[2]).toBeLessThan(first.position[2]);
    expect(Math.abs(first.position[0])).toBeGreaterThan(0);
    expect(last.lookAt[1]).toBe(first.lookAt[1]);
  });

  it("moves beside the focused case without coupling its camera to object rotation", () => {
    const p = stationPlacement(1);
    const pose = routeCameraPose(1, true, 1.4);
    expect(pose.position[1]).toBe(VISITOR_EYE_HEIGHT);
    expect(Math.hypot(pose.position[0] - p.x, pose.position[2] - p.z)).toBeCloseTo(3.2 / Math.sqrt(1.4));
    expect(pose.lookAt).toEqual([p.x, p.plinthTop + 1.25, p.z]);
    expect(routeCameraPose(1, true, 1.4)).toEqual(pose);
  });

  it("keeps the display fronts aimed toward the central river", () => {
    expect(stationFacingYaw(0)).toBeGreaterThan(0);
    expect(stationFacingYaw(1)).toBeLessThan(0);
  });
});
