import { Vector3 } from "three";
import { SLOT_SPACING } from "../gallery/horizontalProjection";

export const RIVER_START_X = 0;
export const RIVER_CURVE_AMPLITUDE = 0.85;
export const RIVER_CURVE_WAVELENGTH = SLOT_SPACING * 4;
export const RIVER_RISE_PER_METER = 0;
export const RIVER_FIRST_BEND_DISTANCE = 0;
export const RIVER_STATION_SPACING = SLOT_SPACING;
export const RIVER_STATION_Z = 0;

/** Exhibits sit on a level row; distance is world X along the horizontal river. */
export function riverStationDistance(index: number): number {
  return Math.max(0, Math.floor(index)) * RIVER_STATION_SPACING;
}

/** The visitor path stays level. Kept as a function so height samples remain explicit. */
export function riverHeightAt(_distance: number): number {
  return 0;
}

export function riverPointAt(distance: number): Vector3 {
  const phase = (distance / RIVER_CURVE_WAVELENGTH) * Math.PI * 2;
  return new Vector3(
    RIVER_START_X + distance,
    0,
    RIVER_CURVE_AMPLITUDE * Math.sin(phase),
  );
}

export function riverTangentAt(distance: number): Vector3 {
  const before = riverPointAt(distance - 0.04);
  const after = riverPointAt(distance + 0.04);
  return after.sub(before).normalize();
}

/** Horizontal unit vector to the visitor's left while following the river. */
export function riverBankNormalAt(distance: number): Vector3 {
  const tangent = riverTangentAt(distance);
  return new Vector3(-tangent.z, 0, tangent.x).normalize();
}
