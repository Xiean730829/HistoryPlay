import { Vector3 } from "three";

export const RIVER_START_Z = 10;
export const RIVER_CURVE_AMPLITUDE = 3.1;
export const RIVER_CURVE_WAVELENGTH = 34;
export const RIVER_RISE_PER_METER = 0.035;
export const RIVER_FIRST_BEND_DISTANCE = RIVER_CURVE_WAVELENGTH / 4;
export const RIVER_STATION_SPACING = RIVER_CURVE_WAVELENGTH / 2;

/** Exhibits sit at successive left/right turning points of the shared S-shaped route. */
export function riverStationDistance(index: number): number {
  return RIVER_FIRST_BEND_DISTANCE + Math.max(0, Math.floor(index)) * RIVER_STATION_SPACING;
}

/** The visitor path rises as a smooth, walkable grade along the same horizontal S curve. */
export function riverHeightAt(distance: number): number {
  return Math.max(0, distance) * RIVER_RISE_PER_METER;
}

export function riverPointAt(distance: number): Vector3 {
  const phase = (distance / RIVER_CURVE_WAVELENGTH) * Math.PI * 2;
  return new Vector3(
    RIVER_CURVE_AMPLITUDE * Math.sin(phase),
    riverHeightAt(distance),
    RIVER_START_Z - distance,
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
