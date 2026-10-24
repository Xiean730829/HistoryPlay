import React from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { projectCorridor } from "./corridorProjection";
import { CorridorMotion } from "./CorridorMotion";
import { ArtifactStation } from "./ExhibitStation";
import { FloorTimeline } from "./FloorTimeline";

interface MuseumCorridorProps {
  artifacts: readonly ArtifactProjection[];
  displayOrder: readonly string[];
  focusedId: string | null;
  session?: ActiveSession | null;
  loading?: boolean;
  navigationDisabled?: boolean;
  onRender?: (status: "rendered" | "degraded", reason?: string) => void;
  onMove?: (direction: "next" | "previous") => void;
}

export function MuseumCorridor({
  artifacts,
  displayOrder,
  focusedId,
  session = null,
  loading = false,
  navigationDisabled = false,
  onRender,
  onMove,
}: MuseumCorridorProps) {
  const motion = React.useRef(new CorridorMotion());
  const [motionReady, setMotionReady] = React.useState(false);
  const [width, setWidth] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const ordered = displayOrder.map((id) => byId.get(id)).filter((item): item is ArtifactProjection => item !== undefined);
  const stations = ordered.length ? ordered : [...artifacts];
  const projection = projectCorridor(stations, focusedId && stations.some((item) => item.id === focusedId) ? focusedId : null, width);
  const years = stations.map((item) => compactTimeLabel(item));
  const activeIndex = focusedId === null ? null : stations.findIndex((item) => item.id === focusedId);

  React.useEffect(() => {
    if (stations.length === 0) return;
    if (motion.current.observe(focusedId).animate) setMotionReady(true);
  }, [focusedId, stations.length]);

  return (
    <section className="corridor" aria-label="唐朝长廊" data-motion-ready={motionReady}>
      <div className="corridor-ceiling" aria-hidden="true" />
      <div className="corridor-wall corridor-wall-left" aria-hidden="true" />
      <div className="corridor-wall corridor-wall-right" aria-hidden="true" />
      <div className="corridor-vanishing-point" aria-hidden="true"><span /></div>
      <div className="corridor-floor" aria-hidden="true">
        <span className="floor-center-line" />
        <span className="floor-edge floor-edge-left" />
        <span className="floor-edge floor-edge-right" />
        <span className="floor-light" />
      </div>

      {projection.filter((item) => item.isVisible).map((item) => {
        const artifact = byId.get(item.id);
        return artifact
          ? <ArtifactStation
              artifact={artifact}
              projection={item}
              session={session}
              onRender={onRender}
              key={item.id}
            />
          : null;
      })}

      <FloorTimeline labels={years} activeIndex={activeIndex !== null && activeIndex >= 0 ? activeIndex : null} />
      {onMove && (
        <nav className="corridor-navigation" aria-label="展厅展位导航">
          <button
            aria-label="上一个展位"
            className="corridor-navigation-button"
            disabled={navigationDisabled || !session || stations.length === 0}
            onClick={() => onMove("previous")}
            type="button"
          >
            <span aria-hidden="true">←</span><span>上一个</span>
          </button>
          <span className="corridor-navigation-position" aria-live="polite">
            {activeIndex !== null && activeIndex >= 0 ? `展位 ${activeIndex + 1} / ${stations.length}` : "未定位"}
          </span>
          <button
            aria-label="下一个展位"
            className="corridor-navigation-button"
            disabled={navigationDisabled || !session || stations.length === 0}
            onClick={() => onMove("next")}
            type="button"
          >
            <span>下一个</span><span aria-hidden="true">→</span>
          </button>
        </nav>
      )}
      {loading && <p className="corridor-state" role="status">正在连接唐朝长廊…</p>}
      {!loading && stations.length === 0 && (
        <p className="corridor-state" role="status">长廊空间已就绪，展位将在已发布内容载入后呈现。</p>
      )}
      <div className="corridor-heading">
        <span>时空博物馆</span>
        <strong>唐朝长廊</strong>
      </div>
    </section>
  );
}

function compactTimeLabel(artifact: ArtifactProjection): string {
  const { start_year: start, end_year: end, precision, display_label: label } = artifact.time_range;
  if (precision === "year" && start === end) return `${start}年`;
  if (precision === "century") return label?.match(/^(\d+世纪)/)?.[1] ?? `${Math.floor((start - 1) / 100) + 1}世纪`;
  return `${start}—${end}年`;
}
