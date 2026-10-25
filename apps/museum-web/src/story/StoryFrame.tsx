import React from "react";
import type { ActiveSession, StoryNodePage } from "../application/museumApi";
import { loadSessionAssetBlob, readStoryNode } from "../application/museumApi";
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
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, page: null, error: true });
      });
    return () => controller.abort();
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
    <section className="story-stage story-cinematic" aria-label="故事场景" data-story-id={node.story_id} data-node-id={node.node_id}>
      {assetIds.length > 0 ? (
        <StoryBackdrop session={session} assetId={assetIds[0]} />
      ) : (
        <div className="story-bleed" role="status">
          <p className="story-visual-empty">这一段尚未绑定场景图；未用其他展品图片替代。</p>
        </div>
      )}
      <div className="story-caption">
        <p className="story-kicker">按需故事 · 当前已提交段落</p>
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

function StoryBackdrop({ session, assetId }: { session: ActiveSession; assetId: string }) {
  const [state, setState] = React.useState<{ id: string; url: string } | { id: string; error: true } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState(null);
    void loadSessionAssetBlob(session, assetId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        if (!blob.type.startsWith("image/")) {
          setState({ id: assetId, error: true });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ id: assetId, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: assetId, error: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session.session_id, session.session_token, assetId]);

  if (state && "url" in state && state.id === assetId) {
    return <div className="story-bleed" data-asset-id={assetId} aria-hidden="true"><img src={state.url} alt="" /></div>;
  }
  if (state && "error" in state && state.id === assetId) {
    return (
      <div className="story-bleed" data-asset-id={assetId} role="alert">
        <p className="story-visual-error">本段绑定的场景图当前不可用，没有改用其他文物图片。</p>
      </div>
    );
  }
  return <div className="story-bleed" data-asset-id={assetId} role="status"><p className="story-visual-empty">正在读取本段场景图…</p></div>;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
