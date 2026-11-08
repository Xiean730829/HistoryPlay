import { DESKTOP_PAGE_SIZE, windowStartForIndex } from "./horizontalProjection";

export interface GalleryWindowBounds {
  start: number;
  end: number;
  pageSize: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Server window_start and page_size, never a client-only page capacity. */
export function galleryWindowBounds(
  total: number,
  windowStart = 0,
  pageSize = DESKTOP_PAGE_SIZE,
): GalleryWindowBounds {
  const size = pageSize > 0 ? pageSize : DESKTOP_PAGE_SIZE;
  const start = windowStartForIndex(windowStart, total, size);
  const end = total <= 0 ? 0 : Math.min(total, start + size);
  return {
    start,
    end,
    pageSize: size,
    total: Math.max(0, total),
    hasPrevious: start > 0,
    hasNext: end < total,
  };
}

/** Song windows are scrolls of three; Tang remains counted in exhibits. */
export function galleryWindowLabel(total: number, windowStart = 0, pageSize = DESKTOP_PAGE_SIZE): string {
  const bounds = galleryWindowBounds(total, windowStart, pageSize);
  if (!bounds.total) return "展厅准备中";
  if (bounds.pageSize === 3) {
    const current = Math.floor(bounds.start / 3) + 1;
    const pages = Math.max(1, Math.ceil(bounds.total / 3));
    return `第${current}卷 · ${bounds.start + 1}—${bounds.end} / 共${pages}卷 · ${bounds.total}件`;
  }
  return `${bounds.start + 1}—${bounds.end} / 共${bounds.total}件`;
}
