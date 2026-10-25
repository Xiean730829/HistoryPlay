import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { RIVER_STATION_SPACING, riverStationDistance } from "./riverPath";
import { stationPlacement } from "./layout";
import { routeCameraPose, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./routeCamera";

describe("smooth river camera route", () => {
  it("follows the curve continuously and rises at the same grade as the walkway", () => {
    const first = routeCameraPose(0, false);
    const halfway = routeCameraPose(0.5, false);
    const nextBend = routeCameraPose(1, false);
    const laterBend = routeCameraPose(2, false);

    expect(first.position).toEqual([
      0,
      VISITOR_EYE_HEIGHT,
      10,
    ]);
    expect(first.lookAt[2]).toBeLessThan(stationPlacement(1).centerZ);
    expect(halfway.position[0]).toBeCloseTo(0);
    expect(halfway.position[1]).toBeGreaterThan(first.position[1]);
    expect(nextBend.position[1] - first.position[1]).toBeCloseTo(riverStationDistance(1) * 0.035);
    expect(nextBend.position[2]).toBeLessThan(first.position[2]);
    expect(nextBend.position[0]).toBeCloseTo(stationPlacement(1).centerX);
    expect(laterBend.lookAt[1]).toBeGreaterThan(first.lookAt[1]);
  });

  it("starts at the gallery entrance with a distant view looking past the first two artifacts", () => {
    const first = routeCameraPose(0, false);
    expect(first.position[2]).toBe(10);
    expect(first.lookAt[2]).toBeLessThan(stationPlacement(1).centerZ);
    expect(routeCameraPose(0, true).position[2]).toBeLessThan(first.position[2]);

    const camera = new PerspectiveCamera(47, 16 / 9, 0.08, 100);
    camera.position.fromArray(first.position);
    camera.lookAt(new Vector3().fromArray(first.lookAt));
    camera.updateMatrixWorld(true);
    for (const index of [0, 1, 2]) {
      const p = stationPlacement(index);
      const projected = new Vector3(p.x, p.plinthTop + 1, p.z).project(camera);
      expect(Math.abs(projected.x), `artifact ${index} should be in horizontal view`).toBeLessThan(1);
      expect(Math.abs(projected.y), `artifact ${index} should be in vertical view`).toBeLessThan(1);
    }
  });

  it("keeps inspection beside the selected bend without coupling the camera to model rotation", () => {
    const p = stationPlacement(1);
    const pose = routeCameraPose(1, true, 1.4);
    expect(pose.position[1]).toBeCloseTo(p.walkY + VISITOR_EYE_HEIGHT);
    expect(Math.hypot(pose.position[0] - p.x, pose.position[2] - p.z))
      .toBeCloseTo(3.2 / Math.sqrt(1.4));
    expect(pose.lookAt).toEqual([p.x, p.plinthTop + 1.25, p.z]);
    expect(routeCameraPose(1, true, 1.4)).toEqual(pose);
  });

  it("faces each alternating bend bay inward toward the shared river", () => {
    expect(stationFacingYaw(0)).toBeGreaterThan(0);
    expect(stationFacingYaw(1)).toBeLessThan(0);
    expect(riverStationDistance(1) - riverStationDistance(0)).toBeCloseTo(RIVER_STATION_SPACING);
  });
});
