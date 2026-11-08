import React from "react";
import type { ActiveSession } from "../application/museumApi";
import {
  artifactDateLabel, songHotspotBindings, songScrollKeyboardIntent, songScrollWindow, type GalleryDocument,
} from "./songScrollLayout";
import { useSongScrollAsset } from "./useSongScrollAsset";
import { kilnSmokeForScroll, SongKilnSmoke } from "./SongKilnSmoke";
import { SongAtmosphere, scrollAtmosphere } from "../atmosphere/SongAtmosphere";
import "./songScroll.css";

export function SongScrollGallery({ session, gallery, busy, onSelect, onRender }: {
  session: ActiveSession;
  gallery: GalleryDocument;
  busy: boolean;
  onSelect: (artifactId: string) => void;
  onRender?: (status: "rendered" | "degraded", reason?: string) => void;
}) {
  const projected = songScrollWindow(session, gallery);
  const scroll = projected?.scroll;
  const bindings = projected ? songHotspotBindings(projected.stations, scroll?.hotspots) : [];
  const [retry, setRetry] = React.useState(0);
  const [focusIndex, setFocusIndex] = React.useState(0);
  const asset = useSongScrollAsset(session, scroll?.background_asset_id, retry);
  const [readyUrl, setReadyUrl] = React.useState<string | null>(null);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const [unrolledUrl, setUnrolledUrl] = React.useState<string | null>(null);
  const ready = !!asset.url && readyUrl === asset.url && failedUrl !== asset.url;
  const unrolled = ready && unrolledUrl === asset.url;
  const latestRender = React.useRef(onRender);
  latestRender.current = onRender;
  const captionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  React.useEffect(() => {
    setFocusIndex(0);
  }, [scroll?.id, session.state.gallery_view?.window_start]);
  React.useEffect(() => {
    if (!ready || !asset.url) return;
    const currentUrl = asset.url;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setUnrolledUrl(currentUrl);
      return;
    }
    // Keep the view usable even if a browser suppresses animation events.
    const timeout = window.setTimeout(() => setUnrolledUrl(currentUrl), 2400);
    return () => window.clearTimeout(timeout);
  }, [ready, asset.url]);
  React.useEffect(() => {
    if (!unrolled) return;
    const frame = requestAnimationFrame(() => latestRender.current?.("rendered"));
    return () => cancelAnimationFrame(frame);
  }, [unrolled, session.state.view_revision, session.state.revision]);

  function applyKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    const origin = event.target as HTMLElement;
    if (origin.closest(".song-scroll-loading")) return;
    const intent = songScrollKeyboardIntent(event.key, bindings.length, focusIndex);
    if (!intent) return;
    event.preventDefault();
    setFocusIndex(intent.index);
    const target = bindings[intent.index];
    if (!target) return;
    if (intent.kind === "select") {
      if (!busy) onSelect(target.artifactId);
      return;
    }
    captionRefs.current[intent.index]?.focus();
  }

  if (!projected) return <section className="song-scroll-gallery" role="status">宋代三件窗口尚未同步，未显示错误的画卷。请稍后重试。</section>;
  const captionColumns = Math.min(3, Math.max(1, bindings.length));
  return <section className="song-scroll-gallery" aria-label="宋代主题画卷" data-gallery-id={gallery.id}
    data-scroll-id={scroll?.id ?? ""} data-window-start={session.state.gallery_view?.window_start ?? 0}
    onKeyDown={applyKeyboard}>
    <header><p>宋代 · 画卷人间</p><h2>{scroll?.title ?? "时间筛选结果"}</h2></header>
    <p className="song-interpretation">{scroll?.interpretation_label ?? "筛选结果可能跨卷，按原策展顺序显示名称；未拼接或伪造画卷。"}</p>
    {scroll && <div className="song-scroll-frame" aria-busy={(!ready || !unrolled) && !asset.error}>
      {asset.url && <div className={`song-scroll-canvas${ready && !unrolled ? " is-unrolling" : ""}`}>
        <div className="song-scroll-paper" onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === "song-scroll-unroll" && asset.url) {
            setUnrolledUrl(asset.url);
          }
        }}>
          <img src={asset.url} alt={`${scroll.title}场景演绎画卷，不是馆藏原图`}
            onLoad={() => setReadyUrl(asset.url)} onError={() => setFailedUrl(asset.url)} />
          {ready && kilnSmokeForScroll(session.pack_id, scroll.id, scroll.background_asset_id) && <SongKilnSmoke />}
          {ready && <SongAtmosphere scroll cues={scrollAtmosphere(session.pack_id, scroll.id, scroll.background_asset_id, session.version)} />}
          {ready && bindings.map((binding) => {
            if (!binding.hotspot) return null;
            const spot = binding.hotspot;
            return <button key={spot.station_id} type="button" className="song-scroll-hotspot" disabled={busy || !unrolled}
              data-station-id={binding.station.id} data-artifact-id={binding.artifactId}
              aria-label={`近看${spot.label}`} onClick={() => onSelect(binding.artifactId)}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.width * 100}%`, height: `${spot.height * 100}%` }} />;
          })}
        </div>
        <span className="song-scroll-axis song-scroll-axis--start" aria-hidden="true" />
        <span className="song-scroll-axis song-scroll-axis--end" aria-hidden="true" />
      </div>}
      {(!asset.url || failedUrl === asset.url) && <div className="song-scroll-loading" role="status">
        {asset.error || failedUrl ? "本卷画面加载失败，没有报告画卷已显示。" : "正在读取当前画卷…"}
        {(asset.error || failedUrl) && <button type="button" onClick={() => setRetry((value) => value + 1)}>重试画卷</button>}
      </div>}
    </div>}
    <ol className="song-scroll-captions" style={{ gridTemplateColumns: `repeat(${captionColumns}, minmax(0, 1fr))` }}>
      {bindings.map((binding, index) => <li key={binding.station.id}>
        <button type="button" disabled={busy} data-station-id={binding.station.id} data-artifact-id={binding.artifactId}
          ref={(node) => { captionRefs.current[index] = node; }}
          onFocus={() => setFocusIndex(index)}
          onClick={() => onSelect(binding.artifactId)}>
          <strong>{binding.name}</strong><span>{artifactDateLabel(binding.station.artifact.time_range)}</span>
        </button>
      </li>)}
    </ol>
    <p className="song-scroll-hint">画中热区和下方名称打开同一展品。实物图仅在独立展品页按需读取。未装配的展位不会补造名称。</p>
  </section>;
}
