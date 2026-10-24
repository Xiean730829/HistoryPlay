import type { CSSProperties } from "react";
import type { ArtifactProjection } from "../application/museumApi";
import type { CorridorProjection } from "./corridorProjection";
import { ArtifactCaption } from "./ArtifactCaption";

interface ExhibitStationProps {
  artifact: ArtifactProjection;
  projection: CorridorProjection;
}

export function ArtifactStation({ artifact, projection }: ExhibitStationProps) {
  const style = {
    "--station-x": `${projection.xPercent}%`,
    "--station-scale": projection.scale,
    "--station-brightness": projection.brightness,
    zIndex: projection.zIndex,
  } as CSSProperties;

  return (
    <article
      className={`corridor-station${projection.isFocused ? " is-focused" : ""}`}
      aria-label={`${artifact.title}展位${projection.isFocused ? "，当前展位" : ""}`}
      aria-current={projection.isFocused ? "location" : undefined}
      style={style}
      data-depth={projection.depth}
    >
      <div className="station-light" aria-hidden="true" />
      <div className="station-object" aria-label="真实模型预览尚未发布" role="img">
        <span className="station-object-core" aria-hidden="true" />
      </div>
      <div className="station-plinth" aria-hidden="true"><span /></div>
      <ArtifactCaption artifact={artifact} />
    </article>
  );
}
