import React from "react";
import type { ActiveSession, StoryNodePage } from "../application/museumApi";
import { loadSessionAssetBlob, readStoryNode } from "../application/museumApi";
import { nextStoryNodeId } from "../gallery/songScrollLayout";
import { StoryWeather, storyWeather } from "./StoryWeather";
import { SongAtmosphere, storyAtmosphere } from "../atmosphere/SongAtmosphere";
import "./story-cinematic.css";

interface StoryFrameProps {
  session: ActiveSession;
  busy: boolean;
  onContinue: () => void;
  onChooseRoute: (targetNodeId: string) => void;
  onReturn: () => void;
}

/** Presents only the node committed by the current session projection. */
export function StoryFrame({ session, busy, onContinue, onChooseRoute, onReturn }: StoryFrameProps) {
  const node = session.context.story_node;
  const committed = session.state.mode === "story"
    && session.context.revision === session.state.revision
    && node !== null
    && node.story_id === session.state.story_id
    && node.node_id === session.state.node_id;
  const [result, setResult] = React.useState<{
    key: string;
    page: StoryNodePage | null;
    error: boolean;
  } | null>(null);
  const key = committed && node ? `${session.session_id}:${session.version}:${node.story_id}:${node.node_id}:${session.state.revision}` : "";
  const page = result?.key === key ? result.page : null;
  const failed = result?.key === key && result.error;

  React.useEffect(() => {
    if (!key || !node) return;
    const controller = new AbortController();
    let prefetchUrl: string | null = null;
    void readStoryNode(session, node.node_id, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        const paragraph = loaded.paragraphs[0];
        if (loaded.content_id !== node.node_id || loaded.version !== session.version
          || paragraph?.content_id !== node.node_id
          || paragraph.authorship.story_id !== node.story_id) {
          setResult({ key, page: null, error: true });
          return;
        }
        setResult({ key, page: loaded, error: false });
        const nextId = nextStoryNodeId(node);
        if (!nextId) return;
        return readStoryNode(session, nextId, controller.signal).then((nextPage) => {
          if (controller.signal.aborted) return;
          const nextAsset = stringIds(nextPage.paragraphs[0]?.presentation?.asset_ids)[0];
          if (!nextAsset) return;
          return loadSessionAssetBlob(session, nextAsset, controller.signal).then((blob) => {
            if (controller.signal.aborted || !blob.type.startsWith("image/")) return;
            const url = URL.createObjectURL(blob);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(url);
              return;
            }
            prefetchUrl = url;
          });
        }).catch(() => undefined);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, page: null, error: true });
      });
    return () => {
      controller.abort();
      if (prefetchUrl) URL.revokeObjectURL(prefetchUrl);
    };
  }, [key, session.session_id, session.session_token, node?.node_id, node?.story_id]);

  if (!committed || !node) {
    return (
      <section className="story-stage story-cinematic" aria-label="故事场景" role="status">
        <div className="story-caption">
          <p className="story-subtitle">正在同步已提交的故事段落…</p>
          {session.state.mode === "story" && (
            <div className="story-actions">
              <button className="button button-quiet" disabled={busy} onClick={onReturn} type="button">
                返回展廊
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const paragraph = page?.paragraphs[0];
  const actions = paragraph?.allowed_actions ?? node.allowed_actions;
  const presentation = paragraph?.presentation ?? node.presentation;
  const assetIds = stringIds(presentation?.asset_ids);
  const canContinue = actions.includes("continue_story");
  // Returning to the saved exhibit anchor is a session-level escape hatch,
  // validated by the command service rather than the current node's exits.

  return (
    <section className={`story-stage story-cinematic${session.pack_id === "cn.song.core" ? " story-cinematic--song" : ""}`} aria-label="故事场景" data-story-id={node.story_id} data-node-id={node.node_id}>
      {assetIds.length > 0 ? (
        <StoryBackdrop session={session} assetId={assetIds[0]} nodeId={node.node_id} />
      ) : (
        <div className="story-bleed" role="status">
          <p className="story-visual-empty">这一段尚未绑定场景图；未用其他展品图片替代。</p>
        </div>
      )}
      {session.pack_id === "cn.song.core" && <StoryOriginalPhoto session={session} />}
      <div className="story-caption">
        <p className="story-kicker">{session.pack_id === "cn.song.core" && session.version.startsWith("0.0.")
          ? "宋代故事 · 艺术演绎候选画面" : "按需故事 · 当前已提交段落"}</p>
        <h2>{page?.content_kind === "story" ? page.title : "故事片段"}</h2>
        {failed ? (
          <p role="alert" className="story-load-error">本段正文暂时无法读取，请稍后重试或返回展廊。</p>
        ) : (
          <p className="story-subtitle" aria-live="polite">{paragraph?.text ?? "正在读取当前故事段落…"}</p>
        )}
        <p className="story-fact-grade">资料标记：{paragraph?.authorship.fact_grade ?? node.fact_grade}</p>
        <div className="story-actions">
          {canContinue && (
            <button className="button" disabled={busy || !page} onClick={onContinue} type="button">
              {busy ? "正在继续…" : "下一段"}
            </button>
          )}
          {actions.includes("choose_route") && node.available_exits
            .filter((exit) => exit.action === "choose_route")
            .map((exit) => (
              <button
                className="button"
                disabled={busy || !page}
                key={exit.target_node_id}
                onClick={() => onChooseRoute(exit.target_node_id)}
                type="button"
              >
                {exit.route_label ?? "选择此方向"}
              </button>
            ))}
          {session.state.mode === "story" && (
            <button className="button button-quiet" disabled={busy} onClick={onReturn} type="button">
              返回展廊
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The authoritative exhibit photo is separate from the creative story illustration. */
function StoryOriginalPhoto({ session }: { session: ActiveSession }) {
  const artifact = session.context.focused_artifact;
  const display = artifact?.presentation?.display;
  const photoId = display?.kind === "photo" || display?.kind === "model3d"
    ? artifact?.presentation?.preview_asset_id : null;
  const [loaded, setLoaded] = React.useState<{ id: string; url: string } | null>(null);
  React.useEffect(() => {
    if (!photoId) return;
    const controller = new AbortController();
    let url: string | null = null;
    void loadSessionAssetBlob(session, photoId, controller.signal).then((blob) => {
      if (controller.signal.aborted || !blob.type.startsWith("image/")) return;
      url = URL.createObjectURL(blob);
      setLoaded({ id: photoId, url });
    }).catch(() => undefined);
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [session.session_id, session.session_token, photoId]);
  if (!photoId || loaded?.id !== photoId || !artifact) return null;
  const label = artifact.id === "cn.song.artifact.house-model" ? "馆藏合照" : "馆藏图片";
  return <a className="story-original-photo" href={loaded.url} target="_blank" rel="noopener noreferrer"
    aria-label={`查看${artifact.title}${label}`}>
    <img src={loaded.url} alt={`${artifact.title}${label}`} />
    <span>{label} · 点击放大</span>
  </a>;
}

function StoryBackdrop({ session, assetId, nodeId }: { session: ActiveSession; assetId: string; nodeId: string }) {
  const [state, setState] = React.useState<
    { id: string; url: string }
    | { id: string; error: "unavailable" | "not-landscape" }
    | null
  >(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState(null);
    void loadSessionAssetBlob(session, assetId, controller.signal)
      .then(async (blob) => {
        if (controller.signal.aborted) return;
        if (!blob.type.startsWith("image/")) {
          setState({ id: assetId, error: "unavailable" });
          return;
        }
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(blob);
        } catch {
          if (!controller.signal.aborted) setState({ id: assetId, error: "unavailable" });
          return;
        }
        const isNotPortrait = bitmap.width >= bitmap.height;
        bitmap.close();
        if (controller.signal.aborted) return;
        if (!isNotPortrait) {
          setState({ id: assetId, error: "not-landscape" });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ id: assetId, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: assetId, error: "unavailable" });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session.session_id, session.session_token, assetId]);

  if (state && "url" in state && state.id === assetId) {
    const weather = storyWeather(session.pack_id, nodeId, assetId);
    return (
      <div className="story-bleed" data-asset-id={assetId} aria-hidden="true">
        <img className="story-bleed-fill" src={state.url} alt="" />
        <img className="story-bleed-main" src={state.url} alt="" />
        {weather && <StoryWeather weather={weather} />}
        <SongAtmosphere cues={storyAtmosphere(session.pack_id, nodeId, assetId)} />
      </div>
    );
  }
  if (state && "error" in state && state.id === assetId) {
    return (
      <div className="story-bleed" data-asset-id={assetId} role="alert">
        <p className="story-visual-error">
          {state.error === "not-landscape"
            ? "故事背景不能使用竖图；这张图片已拦截，没有显示。"
            : "本段绑定的场景图当前不可用，没有改用其他文物图片。"}
        </p>
      </div>
    );
  }
  return <div className="story-bleed" data-asset-id={assetId} role="status"><p className="story-visual-empty">正在读取本段场景图…</p></div>;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
