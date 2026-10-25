import { Box3, Group, Vector3 } from "three";
import { RIVER_STATION_SPACING, riverBankNormalAt, riverPointAt } from "./riverPath";

export const MODEL_SURFACE_OFFSET = 0.014;
export const PEDESTAL_HEIGHT = 0.18;
export const STAIR_STEPS_PER_FLIGHT = 10;
export const STAIR_STEP_RISE = 0.14;
export const STAIR_TREAD_DEPTH = RIVER_STATION_SPACING / STAIR_STEPS_PER_FLIGHT;
export const STAIR_WIDTH = 2.75;
export const LANDING_RISE = STAIR_STEPS_PER_FLIGHT * STAIR_STEP_RISE;
export const LANDING_DEPTH = 1.25;
export { RIVER_STATION_SPACING } from "./riverPath";

export interface StationPlacement {
  /** World-space artifact center and the side of the stair it occupies. */
  x: number;
  z: number;
  distance: number;
  side: -1 | 1;
  centerX: number;
  centerZ: number;
  bankX: number;
  bankZ: number;
  /** World heights: visitor floor, landing surface, and top of the model support. */
  walkY: number;
  landingY: number;
  plinthTop: number;
  top: number;
}

export interface StairStepPlacement {
  x: number;
  z: number;
  distance: number;
  walkY: number;
  topY: number;
  height: number;
  treadDepth: number;
}

export function stationPlacement(index: number): StationPlacement {
  const station = Math.max(0, Math.floor(index));
  const distance = station * RIVER_STATION_SPACING;
  const center = riverPointAt(distance);
  const bank = riverBankNormalAt(distance);
  const side: -1 | 1 = station % 2 === 0 ? -1 : 1;
  const walkY = station * LANDING_RISE;
  const landingY = walkY;
  return {
    x: center.x + bank.x * side * 4.1,
    z: center.z + bank.z * side * 4.1,
    distance,
    side,
    centerX: center.x,
    centerZ: center.z,
    bankX: bank.x,
    bankZ: bank.z,
    walkY,
    landingY,
    plinthTop: landingY + PEDESTAL_HEIGHT,
    top: landingY + PEDESTAL_HEIGHT,
  };
}

/** Shared geometry/camera placement for one tread in the flight after `flightIndex`. */
export function stairStepPlacement(flightIndex: number, stepIndex: number, fraction = 0): StairStepPlacement {
  const flight = Math.max(0, Math.floor(flightIndex));
  const step = Math.max(0, Math.min(STAIR_STEPS_PER_FLIGHT - 1, Math.floor(stepIndex)));
  const part = Math.max(0, Math.min(1, fraction));
  const stepOffset = step + part;
  const distance = flight * RIVER_STATION_SPACING + stepOffset * STAIR_TREAD_DEPTH;
  const point = riverPointAt(distance);
  const walkY = flight * LANDING_RISE + stepOffset * STAIR_STEP_RISE;
  return {
    x: point.x,
    z: point.z,
    distance,
    walkY,
    topY: flight * LANDING_RISE + (step + 1) * STAIR_STEP_RISE,
    height: (step + 1) * STAIR_STEP_RISE,
    treadDepth: STAIR_TREAD_DEPTH,
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

/** Fit the true mesh above its own landing without changing proportions. */
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
