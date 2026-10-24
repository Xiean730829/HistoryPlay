import { Box3, Group, Vector3 } from "three";

export const STAIR_RISER = 0.16;
export const STAIR_TREAD = 0.48;
export const STAIR_START_Z = 3;
export const STAIR_WIDTH = 4.2;
export const STEPS_PER_STATION = 10;
export const PLINTH_HEIGHT = 1.08;
export const MODEL_SURFACE_OFFSET = 0.012;

export interface StationPlacement {
  /** Cabinet center in world X/Z; higher station indices ascend into negative Z. */
  x: number; z: number; stepIndex: number;
  /** Absolute world Y of the central walkway and side landing surfaces. */
  walkY: number; landingY: number;
  /** Absolute world Y of the actual load-bearing cabinet deck; top is its alias. */
  plinthTop: number; top: number;
}

/** Step n is centered here, has STAIR_TREAD depth and top surface walkY. */
export function stairStepPlacement(stepIndex: number): { z: number; walkY: number } {
  return { z: STAIR_START_Z - stepIndex * STAIR_TREAD, walkY: stepIndex * STAIR_RISER };
}

export function stationPlacement(index: number): StationPlacement {
  const stepIndex = 4 + index * STEPS_PER_STATION;
  const step = stairStepPlacement(stepIndex);
  const plinthTop = step.walkY + PLINTH_HEIGHT;
  return { x: index % 2 ? 3.25 : -3.25, z: step.z, stepIndex,
    walkY: step.walkY, landingY: step.walkY, plinthTop, top: plinthTop };
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

/** Fit the true mesh above the plinth; the object keeps its original proportions. */
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
