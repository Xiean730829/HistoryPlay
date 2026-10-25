import { useEffect, useRef, useState } from "react";
import type { ActiveSession } from "../application/museumApi";
import { readStoryNode } from "../application/museumApi";
import { acquireSessionNarration } from "../narration/sessionNarration";
import { StoryFrame } from "./StoryFrame";
import { StoryAutoplayController } from "./StoryAutoplayController";

interface ArtifactStoryStageProps {
  session: ActiveSession;
  busy: boolean;
  voiceDriven?: boolean;
  onContinue: () => void;
  onChooseRoute: (targetNodeId: string) => void;
  onReturn: () => void;
}

/** Mounts a story layer only while its committed node belongs to the anchored exhibit. */
export function ArtifactStoryStage(props: ArtifactStoryStageProps) {
  const { session } = props;
  const node = session.context.story_node;
  const anchor = session.context.focused_artifact;
  if (session.context.revision !== session.state.revision || !node) {
    return (
      <section className="story-stage" aria-label="故事场景" role="status">
        正在同步已提交的故事段落…
        <button className="button button-quiet" disabled={props.busy} onClick={props.onReturn} type="button">
          返回原展台
        </button>
      </section>
    );
  }
  const belongsToAnchor = Boolean(anchor && node && anchor.story_entry_ids?.includes(node.story_id));
  if (!belongsToAnchor) {
    return (
      <section className="story-stage" aria-label="故事场景" role="status">
        当前发布版本没有提供与这件文物绑定的故事段落。返回原展台，文物位置不会改变。
        <button className="button button-quiet" disabled={props.busy} onClick={props.onReturn} type="button">
          返回原展台
        </button>
      </section>
    );
  }
  if (props.voiceDriven) {
    return <>
      <StoryFrame {...props} />
      <div className="story-narration-status" role="status" aria-live="polite">
        <p className="story-assets-note">
          已显示当前固定正文与对应画面。讲解员使用小智实时语音回答；目前没有可验证的逐字音频完成回执，因此不会用浏览器朗读冒充同步讲述或自动翻页。可说“下一段”继续。
        </p>
      </div>
    </>;
  }
  return <StoryAutoplayStage {...props} />;
}

type NarrationStatus = "loading" | "playing" | "interrupted" | "error" | "advancing" | "complete";

function StoryAutoplayStage(props: ArtifactStoryStageProps) {
  const { session } = props;
  const node = session.context.story_node!;
  const identity = {
    sessionId: session.session_id,
    storyId: node.story_id,
    nodeId: node.node_id,
    revision: session.state.revision,
    interactionEpoch: session.state.interaction_epoch,
  };
  const key = JSON.stringify(identity);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const latest = useRef({ onContinue: props.onContinue, onReturn: props.onReturn });
  latest.current = { onContinue: props.onContinue, onReturn: props.onReturn };
  const activeKey = useRef(key);
  activeKey.current = key;
  const controller = useRef<StoryAutoplayController | null>(null);
  const retryLoad = useRef<(() => Promise<boolean | undefined>) | null>(null);
  controller.current?.updateIdentity(identity);
  const previousKey = useRef(key);
  const canContinueRef = useRef(false);
  const [status, setStatus] = useState<NarrationStatus>("loading");
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    setStatus("interrupted");
    setCanRetry(true);
  }, [key]);

  useEffect(() => {
    const runtime = acquireSessionNarration(session.session_id);
    const current = new StoryAutoplayController(runtime.player, (completedKey) => {
      if (activeKey.current !== completedKey) return;
      setStatus("advancing");
      latest.current.onContinue();
    });
    controller.current = current;
    activeKey.current = key;
    canContinueRef.current = false;
    setStatus("loading");
    setCanRetry(false);
    const abort = new AbortController();
    const unsubscribe = runtime.player.subscribe((checkpoint, segment) => {
      if (activeKey.current !== key) return;
      if (checkpoint.state === "preparing" && segment?.role === "story") { setStatus("loading"); setCanRetry(false); }
      else if (checkpoint.state === "playing" && segment?.role === "story") { setStatus("playing"); setCanRetry(false); }
      else if ((checkpoint.state === "preparing" || checkpoint.state === "playing") && segment?.role !== "story") {
        setStatus("interrupted"); setCanRetry(false);
      }
      else if (checkpoint.state === "interrupted") { setStatus("interrupted"); setCanRetry(true); }
      else if (checkpoint.state === "error") { setStatus("error"); setCanRetry(true); }
      else if (checkpoint.state === "completed" && checkpoint.lastCompleted === node.node_id) {
        if (!current.isPlaybackAuthorized(identityRef.current)) { setStatus("interrupted"); setCanRetry(true); }
        else { setStatus(canContinueRef.current ? "advancing" : "complete"); }
      }
    });
    const loadAndPlay = async (): Promise<boolean | undefined> => {
      const playbackIdentity = identityRef.current;
      const playbackKey = JSON.stringify(playbackIdentity);
      const page = await readStoryNode(session, node.node_id, abort.signal);
      if (abort.signal.aborted || activeKey.current !== playbackKey) return undefined;
      const paragraph = page.paragraphs[0];
      if (page.content_id !== node.node_id || page.version !== session.version
        || paragraph?.content_id !== node.node_id
        || paragraph.authorship.story_id !== node.story_id || !paragraph.text.trim()) {
        throw new Error("当前故事段落没有可朗读的固定正文");
      }
      const segment = {
        packId: page.pack_id, version: page.version, contentId: node.node_id,
        text: paragraph.text, role: "story" as const,
      };
      const actions = paragraph.allowed_actions ?? node.allowed_actions;
      canContinueRef.current = actions.includes("continue_story");
      return current.start(playbackIdentity, segment, canContinueRef.current);
    };
    retryLoad.current = loadAndPlay;
    void loadAndPlay().then((played) => {
      if (abort.signal.aborted || activeKey.current !== key || played === undefined) return;
      if (played) {
        setStatus(canContinueRef.current ? "advancing" : "complete");
        setCanRetry(false);
      }
    }).catch(() => {
      if (!abort.signal.aborted && activeKey.current === key) {
        setStatus("error");
        setCanRetry(true);
      }
    });
    return () => {
      abort.abort();
      unsubscribe();
      if (retryLoad.current === loadAndPlay) retryLoad.current = null;
      if (activeKey.current === key) activeKey.current = "";
      current.dispose();
      if (controller.current === current) controller.current = null;
      runtime.release();
    };
  }, [session.session_id, session.session_token, session.version, node.node_id, node.story_id]);

  async function retryNarration() {
    const current = controller.current;
    if (!current) return;
    setStatus("loading");
    setCanRetry(false);
    try {
      const played = await current.retry();
      const loaded = !played ? await retryLoad.current?.() : undefined;
      if (!played && loaded === undefined && activeKey.current === key) {
        setStatus("interrupted");
        setCanRetry(true);
      }
    } catch {
      if (activeKey.current === key) { setStatus("error"); setCanRetry(true); }
    }
  }

  function continueManually() {
    controller.current?.manualAdvance();
    latest.current.onContinue();
  }

  function returnToExhibit() {
    controller.current?.leave();
    latest.current.onReturn();
  }

  const statusText = status === "loading" ? "正在准备本段固定讲述…"
    : status === "playing" ? "正在讲述本段内容；故事画面会在朗读结束后推进。"
      : status === "interrupted" ? "讲述已暂停，画面保持在当前段。说“继续”或重新播放本段。"
        : status === "error" ? "本段固定讲述暂时不可用，故事不会自动跳段。"
          : status === "advancing" ? "本段讲述完成，正在读取下一段…"
            : "本段讲述已完成。";

  return <>
    <StoryFrame {...props} onContinue={continueManually} onReturn={returnToExhibit} />
    <div className="story-narration-status" role="status" aria-live="polite">
      <p className="story-assets-note">{statusText}</p>
      {canRetry && <button className="button button-quiet" disabled={props.busy} onClick={() => void retryNarration()} type="button">
        {status === "error" ? "播放本段讲述" : "重新播放本段"}
      </button>}
    </div>
  </>;
}
