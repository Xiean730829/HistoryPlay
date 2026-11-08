import React from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import type { AssetLease } from "../capabilities/assetLoader";
import { cameraOrbit } from "./cameraOrbit";

const Artifact3D = React.lazy(() =>
  import("./Artifact3D").then((module) => ({ default: module.Artifact3D })),
);

interface FocusedArtifactProps {
  artifact: ArtifactProjection;
  session: ActiveSession;
  poster: string | null;
  onRender?: (status: "rendered" | "degraded", reason?: string) => void;
}

export function FocusedArtifact({ artifact, session, poster, onRender }: FocusedArtifactProps) {
  const display = artifact.presentation?.display;
  const assetId = display?.asset_id?.trim() || "";
  const [assetState, setAssetState] = React.useState<{
    assetId: string;
    url: string | null;
    failed: boolean;
  } | null>(null);
  const modelUrl = assetState?.assetId === assetId ? assetState.url : null;
  const failed = assetState?.assetId === assetId && assetState.failed;

  React.useEffect(() => {
    const controller = new AbortController();
    let lease: AssetLease | null = null;
    if (!assetId || (display?.kind !== "model3d" && display?.kind !== "photo"
      && display?.kind !== "printed_text" && display?.kind !== "interpretive_image")) {
      setAssetState(null);
      return;
    }

    const kind = display?.kind === "model3d" ? "model" : "preview";
    void galleryAssets.acquire(session, assetId, kind, controller.signal)
      .then((assetLease) => {
        lease = assetLease;
        setAssetState({ assetId, url: assetLease.url, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAssetState({ assetId, url: null, failed: true });
      });

    return () => {
      controller.abort();
      lease?.release();
    };
  }, [assetId, display?.kind, session.session_id, session.session_token]);

  if (display?.kind === "photo" || display?.kind === "printed_text" || display?.kind === "interpretive_image") {
    const interpretive = display.kind !== "photo";
    const caption = display.kind === "interpretive_image"
      ? (display.interpretation_label || "艺术演绎，非手迹、非真实肖像")
      : display.kind === "printed_text"
        ? "现代排印文字，不是手迹照片"
        : "当前展位使用照片呈现";
    const alt = display.kind === "photo" ? `${artifact.title}照片展品`
      : display.kind === "printed_text" ? `${artifact.title}排印文字`
      : `${artifact.title}艺术演绎图`;
    return modelUrl
      ? <>
          <img
            alt={alt}
            className="artifact-photo"
            onLoad={() => onRender?.("degraded", caption)}
            src={modelUrl}
          />
          {interpretive && <span className="exhibit-interpretation-label" role="note">{caption}</span>}
        </>
      : <>
          {poster && <img alt="" className="station-preview" src={poster} />}
          <span className="visually-hidden" role="status">{failed ? "展示图不可用，保留真实预览图" : "正在载入展示图"}</span>
        </>;
  }
  if (display?.kind !== "model3d" || !assetId) {
    return <span className="artifact-model-state" role="status">当前展品未绑定展示模型</span>;
  }
  if (failed) {
    return <>
      {poster && <img
        alt=""
        className="station-preview"
        onLoad={() => onRender?.("degraded", "展示模型不可用，实际显示真实预览图")}
        src={poster}
      />}
      <span className="visually-hidden" role="status">三维模型暂不可用，保留真实预览图</span>
    </>;
  }
  if (!modelUrl) {
    return <>
      {poster && <img alt="" className="station-preview" src={poster} />}
      <span className="visually-hidden" role="status">正在载入真实三维模型</span>
    </>;
  }

  return (
    <React.Suspense fallback={poster && <img alt="" className="station-preview" src={poster} />}>
      <Artifact3D
        alt={`${artifact.title}三维模型`}
        key={modelUrl}
        orbit={cameraOrbit(session.state.camera_pose, artifact.presentation?.default_camera?.orbit)}
        renderKey={session.state.view_revision}
        poster={poster}
        onDegraded={() => onRender?.("degraded", "展示模型不可用，实际显示真实预览图")}
        onRendered={() => onRender?.("rendered")}
        src={modelUrl}
      />
    </React.Suspense>
  );
}
