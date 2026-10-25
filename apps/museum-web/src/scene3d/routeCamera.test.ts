import { describe, expect, it } from "vitest";
import { LANDING_RISE, STAIR_STEPS_PER_FLIGHT, stationPlacement } from "./layout";
import { routeCameraPose, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./routeCamera";

describe("stair camera route", () => {
  it("climbs each shared stair tread and reaches higher exhibit landings", () => {
    const first = routeCameraPose(0, false);
    const halfway = routeCameraPose(0.5, false);
    const nextLanding = routeCameraPose(1, false);
    const last = routeCameraPose(2, false);
    expect(first.position).toEqual([0, VISITOR_EYE_HEIGHT, 10]);
    expect(halfway.position[1]).toBeCloseTo(VISITOR_EYE_HEIGHT + LANDING_RISE / 2);
    expect(nextLanding.position[1]).toBeCloseTo(VISITOR_EYE_HEIGHT + LANDING_RISE);
    expect(last.position[1]).toBeCloseTo(VISITOR_EYE_HEIGHT + LANDING_RISE * 2);
    expect(last.position[2]).toBeLessThan(first.position[2]);
    expect(last.lookAt[1]).toBeGreaterThan(first.lookAt[1]);
  });

  it("keeps inspection beside its raised glass case without coupling camera to model rotation", () => {
    const p = stationPlacement(1);
    const pose = routeCameraPose(1, true, 1.4);
    expect(pose.position[1]).toBeCloseTo(p.walkY + VISITOR_EYE_HEIGHT);
    expect(Math.hypot(pose.position[0] - p.x, pose.position[2] - p.z)).toBeCloseTo(3.2 / Math.sqrt(1.4));
    expect(pose.lookAt).toEqual([p.x, p.plinthTop + 1.25, p.z]);
    expect(routeCameraPose(1, true, 1.4)).toEqual(pose);
  });

  it("faces both alternating exhibit banks toward the shared stair", () => {
    expect(stationFacingYaw(0)).toBeGreaterThan(0);
    expect(stationFacingYaw(1)).toBeLessThan(0);
    expect(routeCameraPose(1 / STAIR_STEPS_PER_FLIGHT, false).position[1])
      .toBeGreaterThan(VISITOR_EYE_HEIGHT);
  });
});
