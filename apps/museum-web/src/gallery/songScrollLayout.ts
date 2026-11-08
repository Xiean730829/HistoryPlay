import type { ActiveSession, ArtifactProjection, GalleryDocument, GalleryStation } from "../application/museumApi";
export type { SongHotspot, SongScroll, GalleryDocument, GalleryStation } from "../application/museumApi";
import type { SongHotspot } from "../application/museumApi";

/** Derive the window exclusively from the committed server order, never a local page counter. */
export function songScrollWindow(session: ActiveSession, gallery: GalleryDocument) {
  const view = session.state.gallery_view;
  if (view?.page_size !== 3 || session.state.gallery_id !== gallery.id) return null;
  const ids = session.state.display_order.slice(view.window_start, view.window_start + 3);
  const stations = ids.map((id) => gallery.stations.find((station) => station.artifact.id === id));
  if (!ids.length || stations.some((station) => !station)) return null;
  const visible = stations as GalleryStation[];
  const scroll = gallery.scrolls?.find((item) => visible.every((station) => item.station_ids.includes(station.id)));
  return { stations: visible, scroll: scroll ?? null };
}

export function artifactDateLabel(range: ArtifactProjection["time_range"]): string {
  if (range.precision === "unknown" || range.start_year == null || range.end_year == null) return "时间不详";
  return range.display_label || (range.start_year === range.end_year
    ? `${range.start_year}年` : `${range.start_year}—${range.end_year}年`);
}

export function validSongHotspot(spot: SongHotspot): boolean {
  return [spot.x, spot.y, spot.width, spot.height].every(Number.isFinite)
    && spot.x >= 0 && spot.y >= 0 && spot.width > 0 && spot.height > 0
    && spot.x + spot.width <= 1 && spot.y + spot.height <= 1;
}

/** Pair each visible station with at most one authored hotspot. Never invent missing exhibits. */
export function songHotspotBindings(stations: GalleryStation[], hotspots: SongHotspot[] | undefined) {
  const used = new Set<string>();
  return stations.map((station, index) => {
    const hotspot = (hotspots ?? []).find((spot) =>
      spot.station_id === station.id && validSongHotspot(spot) && !used.has(spot.station_id)) ?? null;
    if (hotspot) used.add(hotspot.station_id);
    return {
      index,
      station,
      hotspot,
      artifactId: station.artifact.id,
      name: station.artifact.title,
    };
  });
}

export type SongScrollKeyboardIntent =
  | { kind: "focus"; index: number }
  | { kind: "select"; index: number };

export function songScrollKeyboardIntent(
  key: string,
  count: number,
  focusedIndex: number,
): SongScrollKeyboardIntent | null {
  if (count <= 0) return null;
  const clamped = Math.max(0, Math.min(count - 1, focusedIndex));
  if (key === "ArrowRight" || key === "ArrowDown") {
    return { kind: "focus", index: Math.min(count - 1, clamped + 1) };
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return { kind: "focus", index: Math.max(0, clamped - 1) };
  }
  if (key === "Home") return { kind: "focus", index: 0 };
  if (key === "End") return { kind: "focus", index: count - 1 };
  const digit = key === "1" || key === "2" || key === "3" ? Number(key) - 1 : -1;
  if (digit >= 0 && digit < count) return { kind: "select", index: digit };
  return null;
}

export interface SongExhibitMediaPlan {
  modelAssetId: string | null;
  photoAssetId: string | null;
  photoKind: "photo" | "printed_text" | "interpretive_image" | "preview_fallback" | null;
  showModel: boolean;
  problem: string | null;
}

/** Only preview/display ids; never fall back to story-image asset_ids. */
export function songExhibitMediaPlan(
  artifact: ArtifactProjection,
  modelFailed: boolean,
): SongExhibitMediaPlan {
  const display = artifact.presentation?.display;
  const preview = artifact.presentation?.preview_asset_id?.trim() || null;
  const displayId = display?.asset_id?.trim() || null;
  const missing = "展示素材制作中；没有用画卷或故事图冒充实物。";
  if (display?.kind === "model3d") {
    const showModel = !modelFailed && !!displayId;
    const photoAssetId = preview ?? null;
    if (!showModel && !photoAssetId) return {
      modelAssetId: null, photoAssetId: null, photoKind: null, showModel: false, problem: missing,
    };
    return {
      modelAssetId: showModel ? displayId : null,
      photoAssetId,
      photoKind: modelFailed ? "preview_fallback" : (photoAssetId ? "photo" : null),
      showModel,
      problem: null,
    };
  }
  if (display?.kind === "photo" || display?.kind === "printed_text" || display?.kind === "interpretive_image") {
    const photoAssetId = displayId ?? preview;
    return {
      modelAssetId: null,
      photoAssetId,
      photoKind: photoAssetId ? display.kind : null,
      showModel: false,
      problem: photoAssetId ? null : missing,
    };
  }
  return { modelAssetId: null, photoAssetId: preview, photoKind: preview ? "photo" : null, showModel: false, problem: preview ? null : missing };
}

export function nextStoryNodeId(node: {
  available_exits?: Array<{ action: string; target_node_id: string }>;
} | null | undefined): string | null {
  return node?.available_exits?.find((exit) => exit.action === "continue_story")?.target_node_id ?? null;
}
