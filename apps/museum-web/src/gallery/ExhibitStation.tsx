import React from "react";
import type { CSSProperties } from "react";
import {
  loadSessionAssetObjectUrl,
  type ArtifactProjection,
  type SessionCredentials,
} from "../application/museumApi";
import type { CorridorProjection } from "./corridorProjection";
import { ArtifactCaption } from "./ArtifactCaption";
import { resolvePreviewAssetId } from "./previewAsset";

interface ExhibitStationProps {
  artifact: ArtifactProjection;
  projection: CorridorProjection;
  session: SessionCredentials | null;
}

export function ArtifactStation({ artifact, projection, session }: ExhibitStationProps) {
  const style = {
    "--station-x": `${projection.xPercent}%`,
    "--station-scale": projection.scale,
    "--station-depth": projection.depth,
    "--station-brightness": projection.brightness,
    zIndex: projection.zIndex,
  } as CSSProperties;
  const previewId = resolvePreviewAssetId(artifact);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setPreviewFailed(false);
    if (!session || !previewId) return;

    void loadSessionAssetObjectUrl(session, previewId)
      .then((url) => {
        objectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          objectUrl = null;
          return;
        }
        setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session?.session_id, session?.session_token, previewId]);

  const waiting = Boolean(session && previewId && !previewUrl && !previewFailed);
  const objectLabel = previewUrl
    ? `${artifact.title}真实模型预览`
    : waiting
      ? "正在载入真实模型预览"
      : "真实模型预览尚未发布";

  return (
    <article
      className={`corridor-station${projection.isFocused ? " is-focused" : ""}${previewUrl ? " has-preview" : ""}${waiting ? " is-loading-preview" : ""}`}
      aria-label={`${artifact.title}展位${projection.isFocused ? "，当前展位" : ""}`}
      aria-current={projection.isFocused ? "location" : undefined}
      style={style}
      data-depth={projection.depth}
    >
      <div className="station-light" aria-hidden="true" />
      <div className="station-object" aria-label={objectLabel} role="img">
        {previewUrl ? (
          <img alt="" className="station-preview" decoding="async" src={previewUrl} />
        ) : (
          <span className="station-object-core" aria-hidden="true" />
        )}
      </div>
      <div className="station-plinth" aria-hidden="true"><span /></div>
      <ArtifactCaption artifact={artifact} />
    </article>
  );
}
