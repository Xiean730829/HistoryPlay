import { useEffect, useRef, useState } from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { MuseumWorld } from "./MuseumWorld";
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
  const key = artifacts.map((item) => `${item.id}:${item.presentation?.display?.asset_id}`).join("|");
  useEffect(() => {
    if (!host.current || !artifacts.length) return;
    setLoaded(0); setError("");
    try {
      const current = new MuseumWorld(host.current, artifacts, session, {
        onSelect: (id) => callbacks.current.onSelect(id),
        onObserve: (yaw, pitch, zoom) => callbacks.current.onObserve(yaw, pitch, zoom),
        onPick: (id) => { setPicked(id); setPickNotice(id ? `正在走近${artifacts.find((item) => item.id === id)?.title ?? "文物"}…` : "请点击河畔展台或文物"); },
        onRender: (status, reason) => callbacks.current.onRender(status, reason),
        onLoaded: setLoaded,
      });
      world.current = current; current.update(session, inspection);
      return () => { current.dispose(); if (world.current === current) world.current = null; };
    } catch { setError("当前浏览器无法创建三维展廊，请启用WebGL后重试。"); }
  }, [session.session_id, session.connection_id, key]);
  useEffect(() => { world.current?.update(session, inspection); }, [session, inspection]);
  useEffect(() => { world.current?.setEnvironment(environment); }, [environment]);
  useEffect(() => { if (inspection) setPickNotice(""); }, [inspection, session.state.focused_entity_id]);
  const focused = artifacts.find((artifact) => artifact.id === session.state.focused_entity_id);
  const focusedEra = focused?.time_range.display_label
    ?? (focused ? `${focused.time_range.start_year}—${focused.time_range.end_year}年` : "");
  return <section className={`museum-space museum-space--${environment}`} aria-label="大唐三维文物展廊" data-renderer="three-webgl" data-models-loaded={loaded} data-last-picked={picked ?? ""}>
    <div className="museum-space-background" aria-hidden="true" />
    <div className="museum-webgl" ref={host} />
    <div className="museum-space-brand"><span>时空博物馆</span><h2>大唐 · 星河寻珍</h2><p>沿星河弯道漫游 · 618 — 907</p></div>
    {focused && !inspection && <div className="museum-focused-artifact" aria-live="polite" aria-label="当前文物">
      <span>当前展品</span><strong>{focused.title}</strong><span>{focusedEra}</span>
    </div>}
    <div className="museum-space-guide">{error || pickNotice || (loaded < Math.min(3, artifacts.length)
      ? `真实文物正在入馆 ${loaded} / ${Math.min(3, artifacts.length)}`
      : inspection ? "拖动旋转文物 · 选择路线继续故事" : "点击河畔文物，走近它的时代")}</div>
  </section>;
}
