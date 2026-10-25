import {
  RIVER_FIRST_BEND_DISTANCE, RIVER_STATION_SPACING, riverHeightAt, riverPointAt, riverStationDistance,
} from "./riverPath";
import { stationPlacement } from "./layout";

export const VISITOR_EYE_HEIGHT = 1.72;
const ENTRY_LOOKAHEAD_DISTANCE = RIVER_FIRST_BEND_DISTANCE + RIVER_STATION_SPACING * 1.5;
type Point = [number, number, number];
export interface RouteCameraPose { position: Point; lookAt: Point }

function routePointAt(routeIndex: number) {
  const distance = riverStationDistance(0) + Math.max(0, routeIndex) * RIVER_STATION_SPACING;
  const point = riverPointAt(distance);
  return { x: point.x, z: point.z, walkY: riverHeightAt(distance), distance };
}

/** The visitor camera follows the same continuous curve as the walkway and exhibit bays. */
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
  if (index === 0) {
    const entrance = riverPointAt(0);
    const overview = riverPointAt(ENTRY_LOOKAHEAD_DISTANCE);
    return {
      position: [entrance.x, entrance.y + VISITOR_EYE_HEIGHT, entrance.z],
      lookAt: [overview.x, overview.y + 1.42, overview.z],
    };
  }
  const here = routePointAt(index);
  const ahead = routePointAt(index + 0.35);
  return {
    position: [here.x, here.walkY + VISITOR_EYE_HEIGHT, here.z],
    lookAt: [ahead.x, ahead.walkY + 1.42, ahead.z],
  };
}

/** Display fronts face the river without coupling the camera to exhibit rotation. */
export function stationFacingYaw(index: number): number {
  const { x, z, centerX, centerZ } = stationPlacement(index);
  return Math.atan2(centerX - x, centerZ - z);
}
