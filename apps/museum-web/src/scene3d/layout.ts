import { Box3, Group, Vector3 } from "three";
import { RIVER_STATION_SPACING, riverBankNormalAt, riverPointAt } from "./riverPath";

export const MODEL_SURFACE_OFFSET = 0.014;
export const PLINTH_TOP_Y = 0.18;
export { RIVER_STATION_SPACING } from "./riverPath";

export interface StationPlacement {
  /** Exhibit position and tangent frame sampled from the same curved river path. */
  x: number;
  z: number;
  distance: number;
  side: -1 | 1;
  centerX: number;
  centerZ: number;
  bankX: number;
  bankZ: number;
  /** World height at the top of the thin pedestal. */
  plinthTop: number;
  top: number;
}

export function stationPlacement(index: number): StationPlacement {
  const distance = Math.max(0, index) * RIVER_STATION_SPACING;
  const center = riverPointAt(distance);
  const bank = riverBankNormalAt(distance);
  const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
  const offset = side * 4.1;
  return {
    x: center.x + bank.x * offset,
    z: center.z + bank.z * offset,
    distance,
    side,
    centerX: center.x,
    centerZ: center.z,
    bankX: bank.x,
    bankZ: bank.z,
    plinthTop: PLINTH_TOP_Y,
    top: PLINTH_TOP_Y,
  };
}

export function nearbyModelIndices(count: number, focused: number, limit = 3): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused)).slice(0, limit));
}

/** The display parent uses unit scale and only Y rotation; tilt must not enter the deck. */
export function maintainSurfaceContact(model: Group, worldSurfaceY: number): void {
  const bottom = new Box3().setFromObject(model).min.y;
  if (Number.isFinite(bottom)) model.position.y += worldSurfaceY - bottom;
}

/** Fit the true mesh above the fine pedestal without changing its proportions. */
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
