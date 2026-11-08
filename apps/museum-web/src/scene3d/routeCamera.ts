import {
  DESKTOP_PAGE_SIZE,
  overviewCameraDistance,
  OVERVIEW_FOV_DEG,
  overviewWindowWidth,
  windowStartForIndex,
} from "../gallery/horizontalProjection";
import { stationPlacement } from "./layout";

export const VISITOR_EYE_HEIGHT = 1.72;
/** Keep camera movement tied to elapsed time, including on slower devices. */
export function cameraFrameEasing(elapsedSeconds: number): number {
  return 1 - Math.exp(-Math.min(Math.max(elapsedSeconds, 0), 0.5) * 5.5);
}
const OVERVIEW_EYE_HEIGHT = 2.35;
type Point = [number, number, number];
export interface RouteCameraPose { position: Point; lookAt: Point }

function windowCenterX(windowStart: number, count: number, pageSize = DESKTOP_PAGE_SIZE): number {
  const visible = Math.max(1, Math.min(pageSize, count - windowStart));
  const first = stationPlacement(windowStart);
  const last = stationPlacement(windowStart + visible - 1);
  return (first.x + last.x) / 2;
}

/** High hall view facing a four-slot window; the camera only translates on X. */
export function galleryOverviewPose(
  windowStart = 0,
  count = DESKTOP_PAGE_SIZE,
  aspect = 16 / 9,
  pageSize = DESKTOP_PAGE_SIZE,
): RouteCameraPose {
  const start = windowStartForIndex(windowStart, Math.max(1, count), pageSize);
  const centerX = windowCenterX(start, Math.max(1, count), pageSize);
  const distance = overviewCameraDistance(aspect, OVERVIEW_FOV_DEG);
  return {
    position: [centerX, OVERVIEW_EYE_HEIGHT, distance],
    lookAt: [centerX, 1.15, 0],
  };
}

/** The visitor camera inspects one exhibit or faces the current horizontal window. */
export function routeCameraPose(
  index: number,
  inspection: boolean,
  zoom = 1,
  overview = false,
  count = DESKTOP_PAGE_SIZE,
  aspect = 16 / 9,
  windowStart?: number,
  pageSize = DESKTOP_PAGE_SIZE,
): RouteCameraPose {
  const p = stationPlacement(index);
  if (inspection) {
    const scale = 1 / Math.sqrt(Math.max(0.3, zoom));
    const cameraDistance = 2.5 * scale;
    return {
      position: [p.x, p.walkY + VISITOR_EYE_HEIGHT, p.z + cameraDistance],
      lookAt: [p.x, p.plinthTop + 1.25, p.z],
    };
  }
  const start = windowStart ?? windowStartForIndex(index, Math.max(1, count), pageSize);
  void overview;
  return galleryOverviewPose(start, count, aspect, pageSize);
}

/** Display fronts face the visitor standing south of the horizontal river. */
export function stationFacingYaw(_index: number): number {
  return 0;
}

export function overviewSpan(): number {
  return overviewWindowWidth();
}
