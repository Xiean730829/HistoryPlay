import React from "react";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import type { AssetLease } from "../capabilities/assetLoader";
import { cameraOrbit } from "./cameraOrbit";
import { artifactDateLabel, songExhibitMediaPlan } from "./songScrollLayout";
import "./songScroll.css";

const Artifact3D = React.lazy(() => import("./Artifact3D").then((module) => ({ default: module.Artifact3D })));

export function SongExhibitPage({ artifact, session, busy, onReturn, onStory, onRender }: {
  artifact: ArtifactProjection;
  session: ActiveSession;
  busy: boolean;
  onReturn: () => void;
  onStory: () => void;
  onRender: (status: "rendered" | "degraded", reason?: string) => void;
}) {
  const display = artifact.presentation?.display;
  const [retry, setRetry] = React.useState(0);
  const [modelFailed, setModelFailed] = React.useState(false);
  const plan = songExhibitMediaPlan(artifact, modelFailed);
  const photoAssetId = plan.photoAssetId;
  const modelAssetId = plan.modelAssetId;
  const showModel = plan.showModel;
  const planProblem = plan.problem;
  const scope = `${session.session_id}:${session.connection_id}:${session.pack_id}:${session.version}:${artifact.id}:${retry}`;
  const [photo, setPhoto] = React.useState<{ scope: string; url: string } | null>(null);
  const [model, setModel] = React.useState<{ scope: string; url: string } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(plan.problem);
  const [photoReady, setPhotoReady] = React.useState(false);
  const [modelReady, setModelReady] = React.useState(false);
  const latestRender = React.useRef(onRender);
  latestRender.current = onRender;
  const currentPhoto = photo?.scope === scope ? photo : null;
  const currentModel = model?.scope === scope ? model : null;

  React.useEffect(() => {
    const controller = new AbortController();
    let photoLease: AssetLease | null = null;
    let modelLease: AssetLease | null = null;
    setProblem(planProblem);
    setPhotoReady(false);
    setModelReady(false);
    setPhoto(null);
    setModel(null);
    async function acquirePhoto() {
      if (!photoAssetId) return;
      try {
        const next = await galleryAssets.acquire(session, photoAssetId, "preview", controller.signal);
        if (controller.signal.aborted) { next.release(); return; }
        photoLease = next;
        setPhoto({ scope, url: next.url });
      } catch (error) {
        if (!controller.signal.aborted) {
          setProblem(error instanceof Error ? error.message : "展品照片加载失败");
        }
      }
    }
    async function acquireModel() {
      if (!showModel || !modelAssetId) return;
      try {
        const next = await galleryAssets.acquire(session, modelAssetId, "model", controller.signal);
        if (controller.signal.aborted) { next.release(); return; }
        modelLease = next;
        setModel({ scope, url: next.url });
      } catch {
        if (!controller.signal.aborted) setModelFailed(true);
      }
    }
    void acquirePhoto();
    void acquireModel();
    return () => { controller.abort(); photoLease?.release(); modelLease?.release(); };
  }, [scope, photoAssetId, modelAssetId, showModel, planProblem, session.session_id, session.session_token]);

  const presented = (!showModel && currentPhoto && photoReady)
    || (showModel && currentModel && modelReady)
    || (modelFailed && currentPhoto && photoReady);
  React.useEffect(() => {
    if (!presented) return;
    const frame = requestAnimationFrame(() => latestRender.current(
      modelFailed ? "degraded" : "rendered",
      modelFailed ? "三维模型未能显示，已改用同件真实预览照片；没有用故事图替代。" : undefined,
    ));
    return () => cancelAnimationFrame(frame);
  }, [presented, modelFailed, scope, session.state.view_revision, session.state.revision]);

  const collection = artifact.museum?.collection_url;
  const safeCollection = collection && /^https?:\/\//u.test(collection) ? collection : null;
  const printed = artifact.presentation?.printed_text;
  const identityLabel = artifact.identity?.label;
  const interpretationLabel = display?.kind === "interpretive_image"
    ? (display.interpretation_label || "艺术演绎，非手迹、非真实肖像")
    : display?.kind === "printed_text"
      ? (printed?.interpretation_label || "现代排印文字，不是手迹照片")
      : null;
  const mediaCaption = modelFailed
    ? "三维模型未能显示，当前为同件真实预览照片（降级）。没有用故事图或画卷冒充馆藏原件。"
    : display?.kind === "interpretive_image"
      ? interpretationLabel
      : display?.kind === "printed_text"
        ? "排印文字与演绎图分开标注；没有用手迹照片冒充。"
        : display?.kind === "photo"
          ? "照片展示 · 暂无已核实、可用的同件三维模型。点击图片可在新页查看完整画幅。"
          : "同件三维模型可拖动旋转；馆藏照片始终可见，可点开完整画幅。";
  const imageAlt = display?.kind === "interpretive_image"
    ? `${artifact.title}艺术演绎图`
    : display?.kind === "printed_text"
      ? `${artifact.title}排印文字`
      : `${artifact.title}馆藏图片`;
  const waiting = !problem && !currentPhoto && !currentModel;
  return <article className="song-exhibit-page" data-artifact-id={artifact.id} aria-labelledby="song-exhibit-title">
    <header className="song-exhibit-heading">
      <button type="button" disabled={busy} onClick={onReturn}>← 返回同一画卷</button>
      <p>宋代展品 · {artifact.category} · {artifactDateLabel(artifact.time_range)}</p>
      <h2 id="song-exhibit-title">{artifact.title}</h2>
      <p>{artifact.presentation?.teaser}</p>
    </header>
    <div className="song-exhibit-media">
      {showModel && currentModel && <div className="song-exhibit-model">
        <React.Suspense fallback={<p role="status">正在准备本件三维查看器…</p>}>
          <Artifact3D src={currentModel.url} poster={currentPhoto?.url ?? null} alt={`${artifact.title}三维模型`}
            orbit={cameraOrbit(session.state.camera_pose, artifact.presentation?.default_camera?.orbit)}
            renderKey={session.state.view_revision} onRendered={() => setModelReady(true)}
            onDegraded={() => setModelFailed(true)} />
        </React.Suspense>
      </div>}
      {currentPhoto && <a className="song-exhibit-photo" href={currentPhoto.url} target="_blank" rel="noopener noreferrer"
        aria-label={`放大查看${imageAlt}`}>
        <img src={currentPhoto.url} alt={imageAlt}
          onLoad={() => setPhotoReady(true)} onError={() => setProblem("馆藏图片解码失败，没有报告展示成功。")} />
      </a>}
      {(waiting || problem) && <div role="status" className="song-media-state">
        <p>{problem ?? "正在按需读取本件展品素材…"}</p>
        {problem && <button type="button" onClick={() => { setModelFailed(false); setRetry((value) => value + 1); }}>重试本件素材</button>}
      </div>}
    </div>
    <div className="song-exhibit-details">
      {identityLabel && <p>画作身份：{identityLabel}{artifact.identity?.kind ? `（${artifact.identity.kind}）` : ""}</p>}
      {interpretationLabel && <p role="note">{interpretationLabel}</p>}
      {printed?.body && <pre className="song-printed-text" aria-label={`${artifact.title}排印原文`}>{printed.body}</pre>}
      <p>{mediaCaption}</p>
      <p>来源：{artifact.museum?.name ?? "以发布包的来源资料为准"}{artifact.museum?.accession ? ` · 馆藏号 ${artifact.museum.accession}` : ""}</p>
      {safeCollection && <a href={safeCollection} target="_blank" rel="noopener noreferrer">查看馆方资料</a>}
      {artifact.story_entry_ids?.length ? <button type="button" disabled={busy || !presented} onClick={onStory}>听这件展品的故事</button>
        : <p role="status">故事制作中：正文和三幕图片尚待逐件确认，未开放播放。</p>}
      <p>小智实时讲解需在本页开启语音。图像出现不代表语音已经播放。</p>
    </div>
  </article>;
}
