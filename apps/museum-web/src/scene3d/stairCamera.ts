import { STAIR_RISER, STAIR_START_Z, STAIR_TREAD, stationPlacement } from "./layout";

export const VISITOR_EYE_HEIGHT = 1.75;
type Point = [number, number, number];
export interface StairCameraPose { position: Point; lookAt: Point }

/** Smooth envelope of the stair treads; the eye stays at least 1.67m above each step. */
export function stairRouteHeight(z: number): number {
  return Math.max(0, (STAIR_START_Z - z) / STAIR_TREAD) * STAIR_RISER;
}

export function stairCameraPose(index: number, inspection: boolean, zoom = 1): StairCameraPose {
  const p = stationPlacement(index);
  if (inspection) {
    const length = Math.hypot(p.x, 1.2);
    const distance = 3.4 / Math.sqrt(Math.max(0.25, zoom));
    const x = p.x - p.x / length * distance;
    const z = p.z + 1.2 / length * distance;
    return { position: [x, stairRouteHeight(z) + VISITOR_EYE_HEIGHT, z],
      lookAt: [p.x, p.plinthTop + 0.8, p.z] };
  }
  const z = index === 0 ? 9.5 : p.z + 1.8;
  return { position: [0, stairRouteHeight(z) + VISITOR_EYE_HEIGHT, z],
    lookAt: [0, stationPlacement(Math.max(1, index + 1)).walkY + 1.6, p.z - 5.8] };
}

/** Display fronts face a visitor on the central stair, independent of observation yaw. */
export function stationFacingYaw(index: number): number {
  return Math.atan2(-stationPlacement(index).x, 1.2);
}
