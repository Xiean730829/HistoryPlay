import { Vector3 } from "three";

export const RIVER_STATION_SPACING = 7.2;
export const RIVER_START_Z = 2;
export const RIVER_CURVE_AMPLITUDE = 3.1;
export const RIVER_CURVE_WAVELENGTH = 34;

/** One horizontal S-curve is shared by the light ribbon, exhibits, pick targets and camera. */
export function riverPointAt(distance: number): Vector3 {
  const phase = (distance / RIVER_CURVE_WAVELENGTH) * Math.PI * 2;
  return new Vector3(RIVER_CURVE_AMPLITUDE * Math.sin(phase), 0, RIVER_START_Z - distance);
}

export function riverTangentAt(distance: number): Vector3 {
  const before = riverPointAt(distance - 0.04);
  const after = riverPointAt(distance + 0.04);
  return after.sub(before).normalize();
}

/** Unit vector to the viewer's left while moving forward down the river. */
export function riverBankNormalAt(distance: number): Vector3 {
  const tangent = riverTangentAt(distance);
  return new Vector3(-tangent.z, 0, tangent.x).normalize();
}
