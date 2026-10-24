import React from "react";
import type { ArtifactProjection, SessionCredentials } from "../application/museumApi";
import { projectCorridor } from "./corridorProjection";
import { ArtifactStation } from "./ExhibitStation";
import { FloorTimeline } from "./FloorTimeline";

interface MuseumCorridorProps {
  artifacts: readonly ArtifactProjection[];
  displayOrder: readonly string[];
  focusedId: string | null;
  session?: SessionCredentials | null;
  loading?: boolean;
}

export function MuseumCorridor({
  artifacts,
  displayOrder,
  focusedId,
  session = null,
  loading = false,
}: MuseumCorridorProps) {
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
  const years = stations.map((item) => item.time_range.display_label ?? `${item.time_range.start_year}—${item.time_range.end_year}年`);
  const activeIndex = focusedId === null ? null : stations.findIndex((item) => item.id === focusedId);

  return (
    <section className="corridor" aria-label="唐朝长廊">
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
          ? <ArtifactStation artifact={artifact} projection={item} session={session} key={item.id} />
          : null;
      })}

      <FloorTimeline labels={years} activeIndex={activeIndex !== null && activeIndex >= 0 ? activeIndex : null} />
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
