import { Box3, Group, Vector3 } from "three";

export const MODEL_SURFACE_OFFSET = 0.014;
export const DISPLAY_CASE_BASE_Y = 0.18;
export const RIVER_STATION_SPACING = 7.2;

export interface StationPlacement {
  /** Alternating display positions beside the centered particle river. */
  x: number;
  z: number;
  /** World height at the top of the thin pedestal. */
  plinthTop: number;
  top: number;
}

export function stationPlacement(index: number): StationPlacement {
  const x = index % 2 === 0 ? -3.35 : 3.35;
  const z = 2 - index * RIVER_STATION_SPACING;
  return { x, z, plinthTop: DISPLAY_CASE_BASE_Y, top: DISPLAY_CASE_BASE_Y };
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
