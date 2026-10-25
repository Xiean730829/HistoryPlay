import { RIVER_STATION_SPACING, stationPlacement } from "./layout";

export const VISITOR_EYE_HEIGHT = 1.72;
type Point = [number, number, number];
export interface RouteCameraPose { position: Point; lookAt: Point }

/** Camera transitions follow the river at one constant eye height; display rotation stays independent. */
export function routeCameraPose(index: number, inspection: boolean, zoom = 1): RouteCameraPose {
  const p = stationPlacement(index);
  if (inspection) {
    const scale = 1 / Math.sqrt(Math.max(0.3, zoom));
    const side = Math.sign(p.x) || -1;
    return {
      // Enter straight through the river-facing glass face so a corner rail cannot cover the model.
      position: [p.x - side * 3.15 * scale, VISITOR_EYE_HEIGHT, p.z],
      lookAt: [p.x, p.plinthTop + 1.25, p.z],
    };
  }
  const follow = Math.max(0, index) * RIVER_STATION_SPACING;
  return {
    position: [0, VISITOR_EYE_HEIGHT, 10 - follow],
    lookAt: [0, 1.42, -5 - follow],
  };
}

/** Display fronts face the particle river, independent of observation yaw. */
export function stationFacingYaw(index: number): number {
  const { x } = stationPlacement(index);
  return Math.atan2(-x, 1.2);
}
