import React from "react";
import type { CSSProperties } from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import type { AssetLease } from "../capabilities/assetLoader";
import type { CorridorProjection } from "./corridorProjection";
import { ArtifactCaption } from "./ArtifactCaption";
import { resolvePreviewAssetId } from "./previewAsset";
import { FocusedArtifact } from "./FocusedArtifact";

interface ExhibitStationProps {
  artifact: ArtifactProjection;
  projection: CorridorProjection;
  session: ActiveSession | null;
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
  const [preview, setPreview] = React.useState<{
    assetId: string;
    url: string | null;
    failed: boolean;
  } | null>(null);
  const previewUrl = preview?.assetId === previewId ? preview.url : null;
  const previewFailed = preview?.assetId === previewId && preview.failed;

  React.useEffect(() => {
    const controller = new AbortController();
    let lease: AssetLease | null = null;
    if (!session || !previewId || !projection.isVisible) {
      setPreview(null);
      return;
    }

    void galleryAssets.acquire(session, previewId, "preview", controller.signal)
      .then((assetLease) => {
        lease = assetLease;
        setPreview({ assetId: previewId, url: assetLease.url, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ assetId: previewId, url: null, failed: true });
      });

    return () => {
      controller.abort();
      lease?.release();
    };
  }, [session?.session_id, session?.session_token, previewId, projection.isVisible]);

  const waiting = Boolean(session && previewId && !previewUrl && !previewFailed);
  const objectLabel = previewUrl
    ? `${artifact.title}真实预览`
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
      <div className="station-object" aria-label={objectLabel}>
        {projection.isFocused && session && artifact.presentation?.display ? (
          <FocusedArtifact artifact={artifact} poster={previewUrl} session={session} />
        ) : previewUrl ? (
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
