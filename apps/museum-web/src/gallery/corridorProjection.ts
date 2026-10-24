/**
 * Project the server's ordered visible artifacts into a stable corridor window.
 *
 * The input array must already follow the server's `display_order`. Route order
 * is also the visual near-to-far order: items before the focus are behind the
 * visitor and clipped; later items recede into the corridor. Viewport width
 * changes spacing only, never ordering or which stations are in the window.
 */
export interface CorridorStation {
  id: string;
}

export interface CorridorProjection {
  id: string;
  displayIndex: number;
  depth: number;
  xPercent: number;
  scale: number;
  zIndex: number;
  brightness: number;
  isFocused: boolean;
  isVisible: boolean;
  hiddenReason: "behind" | "too_far" | null;
}

const MAX_VISIBLE_DEPTH = 3;
const MIN_SCALE = 0.36;
const DEPTH_SCALE_STEP = 0.2;

export function projectCorridor(
  stations: readonly CorridorStation[],
  focusedId: string | null,
  viewportWidth: number,
): CorridorProjection[] {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError("走廊视口宽度必须是正数");
  }

  const indices = new Map<string, number>();
  stations.forEach((station, index) => {
    if (!station.id.trim()) throw new TypeError("展位文物标识不能为空");
    if (indices.has(station.id)) throw new TypeError(`展位文物标识重复：${station.id}`);
    indices.set(station.id, index);
  });

  if (stations.length === 0) return [];
  if (focusedId !== null && !indices.has(focusedId)) {
    throw new RangeError(`当前焦点不在服务端可见顺序中：${focusedId}`);
  }

  // With no focused artifact, place the first server-visible station at the
  // corridor entrance without inventing a focused object.
  const focusedIndex = focusedId === null ? 0 : indices.get(focusedId)!;
  const compact = viewportWidth < 640;
  const laneOffset = compact ? 14 : 20;

  return stations.map((station, index) => {
    const depth = index - focusedIndex;
    const hiddenReason = depth < 0 ? "behind" : depth > MAX_VISIBLE_DEPTH ? "too_far" : null;
    const visibleDepth = Math.max(0, depth);
    const laneDirection = visibleDepth === 0 ? 0 : visibleDepth % 2 === 1 ? 1 : -1;
    const scale = Math.max(MIN_SCALE, 1 - visibleDepth * DEPTH_SCALE_STEP);

    return {
      id: station.id,
      displayIndex: index,
      depth,
      xPercent: 50 + laneDirection * laneOffset * Math.min(1, visibleDepth / 1.5),
      scale,
      zIndex: 100 - visibleDepth,
      brightness: Math.max(0.58, 1 - visibleDepth * 0.12),
      isFocused: station.id === focusedId,
      isVisible: hiddenReason === null,
      hiddenReason,
    };
  });
}
