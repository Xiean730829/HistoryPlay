import { Box3, Group, Vector3 } from "three";
import { DESKTOP_PAGE_SIZE } from "../gallery/horizontalProjection";
import { RIVER_STATION_Z, riverHeightAt, riverStationDistance } from "./riverPath";

export const MODEL_SURFACE_OFFSET = 0.014;
export const PEDESTAL_HEIGHT = 0.18;
export const RIVER_WALKWAY_WIDTH = 4.8;
export const RIVER_WALKWAY_THICKNESS = 0.18;
export { RIVER_STATION_SPACING } from "./riverPath";

export interface StationPlacement {
  /** One exhibit occupies one slot along the shared horizontal river. */
  bendIndex: number;
  x: number;
  z: number;
  distance: number;
  side: -1 | 1;
  centerX: number;
  centerZ: number;
  bankX: number;
  bankZ: number;
  /** World-space river surface and the top of the exhibit support. */
  walkY: number;
  plinthTop: number;
}

export function stationPlacement(index: number): StationPlacement {
  const bendIndex = Math.max(0, Math.floor(index));
  const distance = riverStationDistance(bendIndex);
  const walkY = riverHeightAt(distance);
  const side: -1 | 1 = 1;
  return {
    bendIndex,
    x: distance,
    z: RIVER_STATION_Z,
    distance,
    side,
    centerX: distance,
    centerZ: RIVER_STATION_Z,
    bankX: 0,
    bankZ: 1,
    walkY,
    plinthTop: walkY + PEDESTAL_HEIGHT,
  };
}

/** Pedestal underside used by overview name labels; not an identity. */
export function stationLabelAnchor(index: number): { x: number; y: number; z: number } {
  const placement = stationPlacement(index);
  return { x: placement.x, y: placement.walkY + 0.04, z: placement.z };
}

export function nearbyModelIndices(count: number, focused: number, limit = 3): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused)).slice(0, limit));
}

/** Overview loads the current four-slot window plus at most one neighbor on each side. */
export function overviewModelIndices(
  count: number,
  windowStart = 0,
  pageSize = DESKTOP_PAGE_SIZE,
  prefetch = 1,
): Set<number> {
  const start = Math.max(0, Math.floor(windowStart) - prefetch);
  const end = Math.min(count, Math.floor(windowStart) + pageSize + prefetch);
  return new Set(Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index));
}

/** Keep the true mesh resting on its world-space river-bank pedestal. */
export function maintainSurfaceContact(model: Group, worldSurfaceY: number): void {
  const bottom = new Box3().setFromObject(model).min.y;
  if (Number.isFinite(bottom)) model.position.y += worldSurfaceY - bottom;
}

/** Fit the true mesh above its own support without changing proportions. */
export function seatModel(model: Group, width = 1.65, height = 1.9): Group {
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  if (!Number.isFinite(size.length()) || size.length() === 0) throw new Error("文物几何为空");
  const scale = Math.min(width / Math.max(size.x, size.z), height / size.y);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(model);
  const center = fitted.getCenter(new Vector3());
  model.position.add(new Vector3(-center.x, -fitted.min.y, -center.z));
  const seated = new Group();
  seated.add(model);
  return seated;
}
