import { stationPlacement } from "./layout";
import { riverPointAt } from "./riverPath";

export const VISITOR_EYE_HEIGHT = 1.72;
type Point = [number, number, number];
export interface RouteCameraPose { position: Point; lookAt: Point }

/** Camera transitions follow the river's tangent; display rotation stays independent. */
export function routeCameraPose(index: number, inspection: boolean, zoom = 1): RouteCameraPose {
  const p = stationPlacement(index);
  if (inspection) {
    const scale = 1 / Math.sqrt(Math.max(0.3, zoom));
    const bankSide = p.side;
    const cameraDistance = 3.2 * scale;
    return {
      position: [p.x - p.bankX * bankSide * cameraDistance, VISITOR_EYE_HEIGHT, p.z - p.bankZ * bankSide * cameraDistance],
      lookAt: [p.x, p.plinthTop + 1.25, p.z],
    };
  }
  const follow = p.distance;
  const behind = riverPointAt(follow - 8);
  const ahead = riverPointAt(follow + 8);
  return {
    position: [behind.x, VISITOR_EYE_HEIGHT, behind.z],
    lookAt: [ahead.x, 1.42, ahead.z],
  };
}

/** Display fronts face the river center, independent of observation yaw. */
export function stationFacingYaw(index: number): number {
  const { x, z, centerX, centerZ } = stationPlacement(index);
  return Math.atan2(centerX - x, centerZ - z);
}
