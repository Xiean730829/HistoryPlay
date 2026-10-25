import { Box3, Group, Vector3 } from "three";
import {
  riverBankNormalAt, riverPointAt, riverStationDistance,
} from "./riverPath";

export const MODEL_SURFACE_OFFSET = 0.014;
export const PEDESTAL_HEIGHT = 0.18;
export const RIVER_WALKWAY_WIDTH = 4.8;
export const RIVER_WALKWAY_THICKNESS = 0.18;
export { RIVER_STATION_SPACING } from "./riverPath";

export interface StationPlacement {
  /** One exhibit is assigned to each successive bend in the shared river route. */
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
  const center = riverPointAt(distance);
  const bank = riverBankNormalAt(distance);
  const side: -1 | 1 = bendIndex % 2 === 0 ? -1 : 1;
  return {
    bendIndex,
    x: center.x + bank.x * side * (RIVER_WALKWAY_WIDTH / 2 + 1.55),
    z: center.z + bank.z * side * (RIVER_WALKWAY_WIDTH / 2 + 1.55),
    distance,
    side,
    centerX: center.x,
    centerZ: center.z,
    bankX: bank.x,
    bankZ: bank.z,
    walkY: center.y,
    plinthTop: center.y + PEDESTAL_HEIGHT,
  };
}

export function nearbyModelIndices(count: number, focused: number, limit = 3): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused)).slice(0, limit));
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
