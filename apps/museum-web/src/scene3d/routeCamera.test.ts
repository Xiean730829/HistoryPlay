import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { RIVER_STATION_SPACING, riverStationDistance } from "./riverPath";
import { stationPlacement } from "./layout";
import { cameraFrameEasing, galleryOverviewPose, routeCameraPose, stationFacingYaw, VISITOR_EYE_HEIGHT } from "./routeCamera";

describe("horizontal four-slot camera route", () => {
  it("moves at the same elapsed-time pace when a distant model slows the frame rate", () => {
    const remaining = (dt: number, frames: number) => (1 - cameraFrameEasing(dt)) ** frames;
    expect(remaining(0.2, 5)).toBeCloseTo(remaining(1 / 60, 60), 6);
    expect(cameraFrameEasing(10)).toBe(cameraFrameEasing(0.5));
  });
  it("translates only on X between equal-level windows and does not recede into the distance", () => {
    const first = routeCameraPose(1, false, 1, false, 8, 16 / 9, 0);
    const second = routeCameraPose(5, false, 1, false, 8, 16 / 9, 4);
    const inspect = routeCameraPose(1, true);

    expect(first.position[1]).toBeCloseTo(second.position[1]);
    expect(first.position[2]).toBeCloseTo(second.position[2]);
    expect(second.position[0]).toBeGreaterThan(first.position[0]);
    expect(first.lookAt[1]).toBeCloseTo(second.lookAt[1]);
    expect(inspect.position[1]).toBeCloseTo(stationPlacement(1).walkY + VISITOR_EYE_HEIGHT);
    expect(inspect.position[2]).toBeLessThan(first.position[2]);
  });

  it("keeps four desktop stations in one overview frustum at matching visual size", () => {
    const overview = galleryOverviewPose(0, 8, 16 / 9);
    expect(overview.position[1]).toBeGreaterThan(VISITOR_EYE_HEIGHT);
    expect(routeCameraPose(0, false, 1, false, 8, 16 / 9, 0)).toEqual(overview);
    expect(routeCameraPose(2, false, 1, true, 8, 16 / 9, 0)).toEqual(overview);

    const camera = new PerspectiveCamera(54, 16 / 9, 0.08, 220);
    camera.position.fromArray(overview.position);
    camera.lookAt(new Vector3().fromArray(overview.lookAt));
    camera.updateMatrixWorld(true);
    const projected = [0, 1, 2, 3].map((index) => {
      const p = stationPlacement(index);
      return new Vector3(p.x, p.plinthTop + 1, p.z).project(camera);
    });
    for (const [index, point] of projected.entries()) {
      expect(Math.abs(point.x), `artifact ${index} should be in horizontal view`).toBeLessThan(1);
      expect(Math.abs(point.y), `artifact ${index} should be in vertical view`).toBeLessThan(1);
      expect(point.z, `artifact ${index} should be in front of the camera`).toBeGreaterThan(-1);
      expect(point.z, `artifact ${index} should be in front of the camera`).toBeLessThan(1);
    }
    const widths = projected.map((point) => Math.abs(point.x));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.55);
    const later = new Vector3(
      stationPlacement(5).x,
      stationPlacement(5).plinthTop + 1,
      stationPlacement(5).z,
    ).project(camera);
    expect(later.x).toBeGreaterThan(1);
  });

  it("keeps inspection beside the selected exhibit without coupling the camera to model rotation", () => {
    const p = stationPlacement(1);
    const pose = routeCameraPose(1, true, 1.4);
    expect(pose.position[1]).toBeCloseTo(p.walkY + VISITOR_EYE_HEIGHT);
    expect(Math.hypot(pose.position[0] - p.x, pose.position[2] - p.z))
      .toBeCloseTo(2.5 / Math.sqrt(1.4));
    expect(pose.lookAt).toEqual([p.x, p.plinthTop + 1.25, p.z]);
    expect(routeCameraPose(1, true, 1.4)).toEqual(pose);
  });

  it("faces every case toward the visitor standing south of the river", () => {
    expect(stationFacingYaw(0)).toBe(0);
    expect(stationFacingYaw(1)).toBe(0);
    expect(riverStationDistance(1) - riverStationDistance(0)).toBeCloseTo(RIVER_STATION_SPACING);
  });
});
