import { LANDING_RISE, STAIR_STEPS_PER_FLIGHT, stairStepPlacement, stationPlacement } from "./layout";

export const VISITOR_EYE_HEIGHT = 1.72;
type Point = [number, number, number];
export interface RouteCameraPose { position: Point; lookAt: Point }

function walkPointAt(routeIndex: number) {
  const safe = Math.max(0, routeIndex);
  const flightIndex = Math.floor(safe);
  const flightProgress = (safe - flightIndex) * STAIR_STEPS_PER_FLIGHT;
  if (flightProgress >= STAIR_STEPS_PER_FLIGHT - 1e-6) {
    const landing = stationPlacement(flightIndex + 1);
    return { x: landing.centerX, z: landing.centerZ, walkY: landing.walkY };
  }
  const stepIndex = Math.floor(flightProgress);
  const fraction = flightProgress - stepIndex;
  const step = stairStepPlacement(flightIndex, stepIndex, fraction);
  return { x: step.x, z: step.z, walkY: step.walkY };
}

/** The visitor camera climbs one shared stair tread at a time and rests at its landings. */
export function routeCameraPose(index: number, inspection: boolean, zoom = 1): RouteCameraPose {
  const p = stationPlacement(index);
  if (inspection) {
    const scale = 1 / Math.sqrt(Math.max(0.3, zoom));
    const cameraDistance = 3.2 * scale;
    return {
      position: [p.x - p.bankX * p.side * cameraDistance, p.walkY + VISITOR_EYE_HEIGHT,
        p.z - p.bankZ * p.side * cameraDistance],
      lookAt: [p.x, p.plinthTop + 1.25, p.z],
    };
  }
  const here = walkPointAt(index);
  const ahead = walkPointAt(index + 0.55);
  return {
    position: [here.x, here.walkY + VISITOR_EYE_HEIGHT, here.z],
    lookAt: [ahead.x, ahead.walkY + 1.42, ahead.z],
  };
}

/** Display fronts face the central stair independently of observation yaw. */
export function stationFacingYaw(index: number): number {
  const { x, z, centerX, centerZ } = stationPlacement(index);
  return Math.atan2(centerX - x, centerZ - z);
}

export function routeLandingHeight(index: number): number {
  return Math.max(0, Math.floor(index)) * LANDING_RISE;
}
