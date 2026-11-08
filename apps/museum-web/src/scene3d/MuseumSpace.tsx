import { useEffect, useRef, useState } from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryWindowBounds } from "../gallery/galleryWindow";
import { MuseumWorld } from "./MuseumWorld";
import type { StationLabelProjection } from "./MuseumWorld";
import type { GalleryEnvironment } from "./particleRiver";
import "./museum-space.css";

export function MuseumSpace({ artifacts, session, onSelect, onObserve, onRender, inspection = false }: {
  artifacts: readonly ArtifactProjection[];
  session: ActiveSession;
  inspection?: boolean;
  onSelect(id: string): void;
  onObserve(yaw: number, pitch: number, zoom: number): void;
  onRender(status: "rendered" | "degraded", reason?: string): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<MuseumWorld | null>(null);
  const callbacks = useRef({ onSelect, onObserve, onRender }); callbacks.current = { onSelect, onObserve, onRender };
  const [loaded, setLoaded] = useState(0);
  const environment: GalleryEnvironment = "stars";
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [pickNotice, setPickNotice] = useState("");
  const [previewArtifacts, setPreviewArtifacts] = useState<Set<string>>(() => new Set());
  const [overviewLabels, setOverviewLabels] = useState<StationLabelProjection[]>([]);
  const orderedArtifacts = session.state.display_order.length
    ? session.state.display_order
      .map((id) => artifacts.find((item) => item.id === id))
      .filter((item): item is ArtifactProjection => Boolean(item))
    : artifacts;
  const key = orderedArtifacts.map((item) => `${item.id}:${item.presentation?.display?.asset_id}`).join("|");
  useEffect(() => {
    if (!host.current || !orderedArtifacts.length) return;
    setLoaded(0); setError(""); setPreviewArtifacts(new Set());
    try {
      const current = new MuseumWorld(host.current, orderedArtifacts, session, {
        onSelect: (id) => callbacks.current.onSelect(id),
        onObserve: (yaw, pitch, zoom) => callbacks.current.onObserve(yaw, pitch, zoom),
        onPick: (id) => { setPicked(id); setPickNotice(id ? `正在走近${orderedArtifacts.find((item) => item.id === id)?.title ?? "文物"}…` : "请点击展台上的文物"); },
        onRender: (status, reason) => callbacks.current.onRender(status, reason),
        onLoaded: setLoaded,
        onPreview: (id, visible) => setPreviewArtifacts((current) => {
          const next = new Set(current);
          if (visible) next.add(id); else next.delete(id);
          return next;
        }),
        onLabels: (labels) => setOverviewLabels(labels.map((item) => ({ ...item }))),
      });
      world.current = current; current.update(session, inspection);
      return () => { current.dispose(); if (world.current === current) world.current = null; };
    } catch { setError("当前浏览器无法创建三维展廊，请启用WebGL后重试。"); }
  }, [session.session_id, session.connection_id, key]);
  useEffect(() => { world.current?.update(session, inspection); }, [session, inspection]);
  useEffect(() => { world.current?.setEnvironment(environment); }, [environment]);
  useEffect(() => { if (inspection) { setPickNotice(""); setOverviewLabels([]); } }, [inspection, session.state.focused_entity_id]);
  const focused = orderedArtifacts.find((artifact) => artifact.id === session.state.focused_entity_id);
  const focusedEra = focused?.time_range.display_label
    ?? (focused ? `${focused.time_range.start_year}—${focused.time_range.end_year}年` : "");
  const pageSize = session.state.gallery_view?.page_size ?? 4;
  const total = orderedArtifacts.length;
  const bounds = galleryWindowBounds(total, session.state.gallery_view?.window_start ?? 0, pageSize);
  const visibleCount = Math.max(0, bounds.end - bounds.start);
  const windowLabel = total
    ? `${bounds.start + 1}—${bounds.end} / 共${total}件`
    : "展厅准备中";
  return <section className={`museum-space museum-space--${environment}`} aria-label="大唐横向银河展廊" data-renderer="three-webgl" data-models-loaded={loaded} data-last-picked={picked ?? ""} data-window={windowLabel}>
    <div className="museum-space-background" aria-hidden="true" />
    <div className="museum-webgl" ref={host} />
    <div className="museum-space-brand"><span>时空博物馆</span><h2>大唐 · 星河寻珍</h2><p>横向银河展廊 · 618 — 907</p></div>
    <div className="museum-window-meter" aria-live="polite">{windowLabel}</div>
    {!inspection && overviewLabels.length > 0 && <div className="museum-overview-labels" aria-label="当前窗口展品名称">
      {overviewLabels.map((label) => (
        <button
          key={label.id}
          type="button"
          className="museum-overview-label"
          hidden={!label.visible}
          style={{ left: `${label.x}%`, top: `${label.y}%` }}
          onClick={() => callbacks.current.onSelect(label.id)}
        >
          <strong>{label.title}</strong>
        </button>
      ))}
    </div>}
    {focused && inspection && <div className="museum-focused-artifact" aria-live="polite" aria-label="当前文物">
      <span>当前展品</span><strong>{focused.title}</strong><span>{focusedEra}</span>
    </div>}
    <div className="museum-space-guide">{error || pickNotice || (previewArtifacts.size > 0
      ? `当前 ${previewArtifacts.size} 件显示馆藏真实预览；三维模型仍在载入或暂不可用`
      : loaded < visibleCount
        ? `真实文物正在入馆 ${loaded} / ${visibleCount}`
        : inspection ? "拖动旋转文物 · 选择路线继续故事" : "点击眼前文物，走近它的时代")}</div>
  </section>;
}
