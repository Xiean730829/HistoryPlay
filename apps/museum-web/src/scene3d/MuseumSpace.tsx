import { useEffect, useRef, useState } from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { MuseumWorld } from "./MuseumWorld";
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
        onPick: (id) => { setPicked(id); setPickNotice(id ? `正在走近${artifacts.find((item) => item.id === id)?.title ?? "文物"}…` : "请点击展台或文物，柱子后面的文物需要先走近"); },
        onRender: (status, reason) => callbacks.current.onRender(status, reason),
        onLoaded: setLoaded,
      });
      world.current = current; current.update(session, inspection);
      return () => { current.dispose(); if (world.current === current) world.current = null; };
    } catch { setError("当前浏览器无法创建三维展廊，请启用WebGL后重试。"); }
  }, [session.session_id, session.connection_id, key]);
  useEffect(() => { world.current?.update(session, inspection); }, [session, inspection]);
  useEffect(() => { if (inspection) setPickNotice(""); }, [inspection, session.state.focused_entity_id]);
  return <section className="museum-space" aria-label="大唐三维展廊" data-renderer="three-webgl" data-models-loaded={loaded} data-last-picked={picked ?? ""}>
    <div className="museum-webgl" ref={host} />
    <div className="museum-space-brand"><span>时空博物馆</span><h2>大唐 · 文物长廊</h2><p>618 — 907</p></div>
    <div className="museum-space-guide">{error || pickNotice || (loaded < Math.min(3, artifacts.length)
      ? `真实文物正在入馆 ${loaded} / ${Math.min(3, artifacts.length)}`
      : inspection ? "拖动观察文物 · 随时可以进入它的故事" : "点击展台上的文物，走近它的时代")}</div>
  </section>;
}
