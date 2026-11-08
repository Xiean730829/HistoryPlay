/**
 * Project the server display_order into a horizontal four-slot window.
 *
 * Slot layout is a pure function of ordered IDs, window start, page size and
 * viewport width. It does not fetch, mutate session state, or invent order.
 */
export interface HorizontalStation {
  id: string;
}

export interface HorizontalSlot {
  id: string;
  displayIndex: number;
  slotIndex: number;
  xPercent: number;
  scale: number;
  isFocused: boolean;
  isVisible: boolean;
}

export const DESKTOP_PAGE_SIZE = 4;
export const SLOT_SPACING = 5.6;
export const SLOT_CENTER_FRACTIONS = [0.125, 0.375, 0.625, 0.875] as const;
export const OVERVIEW_FOV_DEG = 54;

export function pageSizeForViewport(width: number): 1 | 2 | 4 {
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError("展廊视口宽度必须是正数");
  }
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 4;
}

export function windowStartForIndex(index: number, count: number, pageSize: number): number {
  if (count <= 0 || pageSize <= 0) return 0;
  const clamped = Math.max(0, Math.min(count - 1, Math.floor(index)));
  const start = Math.floor(clamped / pageSize) * pageSize;
  const lastStart = Math.max(0, Math.floor((count - 1) / pageSize) * pageSize);
  return Math.min(start, lastStart);
}

export function overviewWindowWidth(): number {
  return SLOT_SPACING * DESKTOP_PAGE_SIZE;
}

export function overviewCameraDistance(aspect: number, fovDeg = OVERVIEW_FOV_DEG): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError("相机宽高比必须是正数");
  }
  const halfFov = (fovDeg * Math.PI) / 360;
  return overviewWindowWidth() / (2 * Math.tan(halfFov) * aspect);
}

export interface TimeRangeLike {
  start_year: number;
  end_year: number;
}

/** Closed-interval intersection used by the server time filter. */
export function intersectsTimeRange(range: TimeRangeLike, filter: TimeRangeLike): boolean {
  const start = Math.min(range.start_year, range.end_year);
  const end = Math.max(range.start_year, range.end_year);
  const filterStart = Math.min(filter.start_year, filter.end_year);
  const filterEnd = Math.max(filter.start_year, filter.end_year);
  return start <= filterEnd && end >= filterStart;
}

export function filterStationsByTime<T extends { time_range: TimeRangeLike }>(
  stations: readonly T[],
  filter: TimeRangeLike | null | undefined,
): T[] {
  if (!filter) return [...stations];
  return stations.filter((item) => intersectsTimeRange(item.time_range, filter));
}

export function projectHorizontal(
  stations: readonly HorizontalStation[],
  focusedId: string | null,
  viewportWidth: number,
  windowStart?: number,
): HorizontalSlot[] {
  const pageSize = pageSizeForViewport(viewportWidth);
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
  const focusedIndex = focusedId === null ? 0 : indices.get(focusedId)!;
  const start = windowStartForIndex(
    windowStart === undefined ? focusedIndex : windowStart,
    stations.length,
    pageSize,
  );
  const fractions = SLOT_CENTER_FRACTIONS.slice(0, pageSize);
  return stations.map((station, index) => {
    const slotIndex = index - start;
    const isVisible = slotIndex >= 0 && slotIndex < pageSize;
    return {
      id: station.id,
      displayIndex: index,
      slotIndex,
      xPercent: isVisible ? fractions[slotIndex]! * 100 : 0,
      scale: 1,
      isFocused: station.id === focusedId,
      isVisible,
    };
  });
}
