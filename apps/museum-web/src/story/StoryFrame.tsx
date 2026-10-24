import React from "react";
import type { ActiveSession, StoryNodePage } from "../application/museumApi";
import { loadSessionAssetBlob, readStoryNode } from "../application/museumApi";

interface StoryFrameProps {
  session: ActiveSession;
  busy: boolean;
  onContinue: () => void;
  onReturn: () => void;
}

/** Presents only the node committed by the current session projection. */
export function StoryFrame({ session, busy, onContinue, onReturn }: StoryFrameProps) {
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
      <section className="story-stage" aria-label="故事场景" role="status">
        正在同步已提交的故事段落…
        <button className="button button-quiet" disabled={busy} onClick={onReturn} type="button">返回原展台</button>
      </section>
    );
  }

  const paragraph = page?.paragraphs[0];
  const actions = paragraph?.allowed_actions ?? node.allowed_actions;
  const presentation = paragraph?.presentation ?? node.presentation;
  const assetIds = stringIds(presentation?.asset_ids);

  return (
    <section className="story-stage" aria-label="故事场景" data-story-id={node.story_id} data-node-id={node.node_id}>
      <div className="story-stage-backdrop" aria-hidden="true" />
      <div className="story-frame">
        <p className="story-kicker">按需故事 · 当前已提交段落</p>
        <h2>{page?.content_kind === "story" ? page.title : "故事片段"}</h2>
        {assetIds.length > 0 ? (
          <StoryImages session={session} assetIds={assetIds} />
        ) : (
          <p className="story-assets-note">这一段尚未绑定人物或场景图；未用其他展品图片替代。</p>
        )}
        {failed ? (
          <p role="alert" className="story-load-error">本段正文暂时无法读取，请稍后重试或返回展台。</p>
        ) : (
          <p className="story-subtitle" aria-live="polite">{paragraph?.text ?? "正在读取当前故事段落…"}</p>
        )}
        <p className="story-fact-grade">资料标记：{paragraph?.authorship.fact_grade ?? node.fact_grade}</p>
        <div className="story-actions">
          {actions.includes("continue_story") && (
            <button className="button" disabled={busy || !page} onClick={onContinue} type="button">
              {busy ? "正在继续…" : "继续故事"}
            </button>
          )}
          <button className="button button-quiet" disabled={busy} onClick={onReturn} type="button">
            返回原展台
          </button>
        </div>
      </div>
    </section>
  );
}

function StoryImages({ session, assetIds }: { session: ActiveSession; assetIds: string[] }) {
  const [urls, setUrls] = React.useState<Array<{ id: string; url: string }>>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    const objectUrls: string[] = [];
    setUrls([]);
    void Promise.all(assetIds.map(async (id) => {
      try {
        const blob = await loadSessionAssetBlob(session, id, controller.signal);
        if (controller.signal.aborted || !blob.type.startsWith("image/")) return null;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return { id, url };
      } catch {
        return null;
      }
    })).then((loaded) => {
      if (!controller.signal.aborted) setUrls(loaded.filter((item): item is { id: string; url: string } => item !== null));
    });
    return () => {
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [session.session_id, session.session_token, assetIds.join("\u0000")]);

  return (
    <div className="story-images" aria-label="本段已绑定素材">
      {urls.map((item, index) => <img key={item.id} src={item.url} alt={`本段场景素材 ${index + 1}`} />)}
      {urls.length === 0 && <p className="story-assets-note">本段绑定的场景素材当前不可用。</p>}
    </div>
  );
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
