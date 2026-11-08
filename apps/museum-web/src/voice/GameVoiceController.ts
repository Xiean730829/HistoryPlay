import { ApiRequestError, readStoryNode, refreshSession } from "../application/museumApi";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import type { AudioFocus, AudioLease } from "../narration/AudioFocus";
import type { NarrationPlayer } from "../narration/NarrationPlayer";
import { acquireSessionNarration, attachSessionNarrationTransport } from "../narration/sessionNarration";
import { ExhibitGuideController, isStoryOfferConsent } from "./ExhibitGuideController";
import { PlaybackQueue } from "./PlaybackQueue";
import { VoiceClient } from "./VoiceClient";
import type { VoiceControlResult } from "./VoiceClient";
import { isCloseUpIntroAction, isOverviewWindowAction, isRenderGatedAction } from "./renderGatedActions";
import { resolveLocalVoiceBridgeUrl } from "./localVoiceBridgeUrl";
import { voiceTrace } from "./VoiceTrace";
import { TANG_PORTAL_WELCOME } from "../presentation/eraSelection";

export interface GameVoiceHooks {
  onStatus(message: string): void;
  onTranscript(text: string): void;
  onUserTranscript?(text: string): void;
  onNewInput?(): void;
  onStoryTransition?(action: string): void;
  onRefresh(receipt?: CommandReceipt): Promise<"rendered" | "degraded" | "pending">;
  onPresentation?(action: "focus_current" | "return_to_overview"): Promise<"rendered" | "degraded" | "pending">;
}

/** One current game session; never creates or pairs another session. */
export class GameVoiceController {
  private audio: AudioContext | null = null;
  private voice: VoiceClient | null = null;
  private readonly focus: AudioFocus;
  private readonly narration: NarrationPlayer;
  private readonly releaseNarration: () => void;
  private detachNarration: (() => void) | null = null;
  private qaLease: { sequence: number; lease: AudioLease } | null = null;
  private soundOwner: "idle" | "qa" | "fixed" | "overview" = "idle";
  private readonly guide: ExhibitGuideController;
  private disposed = false;
  private inputSequence = 0;
  private welcomeAttemptId = 0;
  private welcomePhase: "idle" | "preparing" | "playing" | "completed" | "failed" = "idle";

  constructor(private readonly session: ActiveSession, private readonly hooks: GameVoiceHooks,
    private readonly gameUrl = "http://127.0.0.1:8793",
    private readonly bridgeUrl = "http://127.0.0.1:8782") {
    const runtime = acquireSessionNarration(session.session_id);
    this.focus = runtime.focus;
    this.narration = runtime.player;
    this.releaseNarration = runtime.release;
    this.guide = new ExhibitGuideController(session, {
      onStatus: (message) => this.hooks.onStatus(message),
      speakIntro: (sequence, revision) => this.speakFocusedArtifact(sequence, revision),
      presentInspection: async (receipt) => this.hooks.onRefresh(receipt),
      beforeStoryEntry: () => this.releaseQaLease(),
      onStoryOpened: async (receipt) => { await this.control({ kind: "action", receipt, message: "故事已打开" }); },
      currentSequence: () => this.inputSequence,
      disposed: () => this.disposed,
    });
  }

  async initialize(): Promise<void> {
    this.disposed = false;
    const bridgeUrl = resolveLocalVoiceBridgeUrl(this.bridgeUrl, window.location.origin);
    this.audio = new AudioContext();
    await this.audio.resume();
    this.hooks.onStatus("正在连接当前展台语音");
    const entryResponse = await fetch(`${bridgeUrl}/voice/entry`, { signal: AbortSignal.timeout(8000) });
    if (!entryResponse.ok) throw new Error("无法读取本机展台语音入口配置");
    const entry = await entryResponse.json() as {
      service?: string;
      web_origin?: string;
      web_origins?: string[];
      device_configured?: boolean;
    };
    const allowedOrigins = entry.web_origins?.length
      ? entry.web_origins
      : entry.web_origin ? [entry.web_origin] : [];
    if (entry.service !== "museum-voice" || allowedOrigins.length === 0) {
      throw new Error("本机语音入口配置无效");
    }
    if (!allowedOrigins.includes(window.location.origin)) {
      throw new Error(`当前页面来源与语音桥不匹配，可用展台入口：${allowedOrigins.join("、")}`);
    }
    if (entry.device_configured !== true) throw new Error("本机小智设备尚未配置，无法开启语音讲述");
    const response = await fetch(`${bridgeUrl}/voice/bind`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ base_url: this.gameUrl, session_id: this.session.session_id,
        session_token: this.session.session_token, connection_id: this.session.connection_id }),
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error("当前网页来源未获本机语音桥授权，请从配置的唯一展台入口打开");
      const diagnosis = await response.json().catch(() => null) as {
        error?: unknown; stage?: unknown; code?: unknown;
      } | null;
      const stage = typeof diagnosis?.stage === "string" && /^[a-z_]{1,48}$/.test(diagnosis.stage)
        ? diagnosis.stage : "unknown";
      const code = typeof diagnosis?.code === "string" && /^[a-z0-9_]{1,48}$/.test(diagnosis.code)
        ? diagnosis.code : `http_${response.status}`;
      if (diagnosis?.error === "voice_bind_failed") {
        throw new Error(`语音绑定失败，阶段：${stage}，代码：${code}`);
      }
      throw new Error("当前展台语音绑定失败，请确认游戏与语音服务已启动");
    }
    const result = await response.json() as { binding_id: string };
    if (this.disposed) return;
    const healthResponse = await fetch(`${bridgeUrl}/voice/status`, { signal: AbortSignal.timeout(8000) });
    if (!healthResponse.ok) throw new Error("本机语音桥拒绝当前网页来源，请从配置的唯一展台入口打开");
    const health = await healthResponse.json() as { service?: string; device_configured?: boolean };
    if (health.service !== "museum-voice" || health.device_configured !== true) {
      this.hooks.onStatus("展台已绑定，讲解员设备尚未配置；当前可用MCP只读讲解");
      throw new Error("展台已绑定，完成一次讲解员设备配置后即可开启游戏语音");
    }
    this.voice = new VoiceClient(new PlaybackQueue(this.audio), {
      onState: (state, message) => {
        if (!this.disposed) this.hooks.onStatus(message ?? ({ connecting: "正在连接讲解员",
          connected: "语音已连接，可以说话", disconnected: "语音已断开", error: "语音连接出错" }[state]));
      },
      onText: (type, text, state) => {
        if (this.disposed || !text.trim()) return;
        if (type === "stt") {
          this.hooks.onTranscript(text);
          const utteranceId = voiceTrace.snapshot()?.utteranceId;
          void this.guide.acceptConsentFromTranscript(text, utteranceId)
            .then((consumed) => consumed
              ? true
              : this.guide.acceptExplicitStoryFromTranscript(text, utteranceId))
            .catch((error: unknown) => {
              if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "打开故事失败");
            });
          this.hooks.onUserTranscript?.(text);
        }
        else if (type === "tts" && state !== "start") this.hooks.onTranscript(text);
        else if (type === "tts" && state === "start") this.hooks.onStatus("讲解员正在结合当前展台内容回答");
      },
      onControl: (control) => { void this.control(control).catch((error: unknown) => {
        if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "语音操作失败");
      }); },
    }, `${bridgeUrl.replace(/^http/, "ws")}/voice/ws`, result.binding_id);
    this.detachNarration = attachSessionNarrationTransport(this.session.session_id, {
      narrate: (prompt, expected, signal, onStarted, meta) => this.voice
        ? this.voice.speakFixedText(prompt, expected, signal, onStarted, meta)
        : Promise.reject(new Error("当前小智语音连接已关闭")),
    });
    await this.voice.connect();
    this.hooks.onStatus("小智讲解员已连接；固定故事讲述以实际字幕和音频完成状态推进");
  }

  isWelcomeActive(): boolean {
    return this.welcomePhase === "preparing" || this.welcomePhase === "playing";
  }

  welcomeGeneration(): number {
    return this.welcomeAttemptId;
  }

  pauseNarration(): void {
    this.inputSequence += 1;
    this.welcomeAttemptId += 1;
    this.welcomePhase = "idle";
    this.releaseQaLease();
    this.narration.stop();
    this.hooks.onNewInput?.();
  }

  async speakPrompt(text: string): Promise<void> {
    if (this.disposed || !this.voice || !text.trim()) return;
    this.pauseNarration();
    const sequence = this.inputSequence;
    await this.speakControlMessage(text, sequence, false);
  }

  async speakWelcome(text = TANG_PORTAL_WELCOME): Promise<void> {
    if (!this.voice) throw new Error("小智讲解员尚未连接");
    const attemptId = ++this.welcomeAttemptId;
    const contentId = "museum.portal.welcome";
    this.welcomePhase = "preparing";
    voiceTrace.record("guide", {
      welcome: "preparing", attempt: attemptId, content_id: contentId, sequence: this.inputSequence,
    });
    this.hooks.onStatus("小智正在介绍博物馆入口；环境声不会开新一轮，要插话请按住说话");
    let completed = false;
    try {
      this.welcomePhase = "playing";
      voiceTrace.record("guide", { welcome: "playing", attempt: attemptId, content_id: contentId });
      completed = await this.narration.play({
        packId: this.session.pack_id,
        version: this.session.version,
        contentId,
        role: "answer",
        text,
      });
    } catch (error) {
      if (attemptId !== this.welcomeAttemptId || this.disposed) {
        throw new Error("入馆欢迎语被手动打断，可以直接说“可以”进入或提问");
      }
      const failure = classifyWelcomeFailure(error, false);
      this.welcomePhase = "failed";
      voiceTrace.record("guide", {
        welcome: "failed", attempt: attemptId, reason: failure.reason, content_id: contentId,
      });
      throw new Error(failure.message);
    }
    if (attemptId !== this.welcomeAttemptId || this.disposed) {
      this.welcomePhase = "failed";
      voiceTrace.record("guide", {
        welcome: "failed", attempt: attemptId, reason: "stale_attempt", content_id: contentId,
      });
      throw new Error("入馆欢迎语被手动打断，可以直接说“可以”进入或提问");
    }
    if (!completed) {
      const interrupted = this.narration.getCheckpoint().state === "interrupted";
      const failure = classifyWelcomeFailure(null, interrupted);
      this.welcomePhase = "failed";
      voiceTrace.record("guide", {
        welcome: "failed", attempt: attemptId, reason: failure.reason, content_id: contentId,
      });
      throw new Error(failure.message);
    }
    this.welcomePhase = "completed";
    voiceTrace.record("guide", { welcome: "completed", attempt: attemptId, content_id: contentId });
    this.hooks.onStatus(text.includes("进入唐代")
      ? "欢迎语已播完，请说进入唐代或进入宋代"
      : "欢迎语已播完，请说“可以”进入博物馆");
  }

  noteCandidate(): void { this.voice?.duckPlayback(true); }
  noteMisfire(): void { this.voice?.duckPlayback(false); }

  beginTurn(source: "user_manual_interrupt" | "gate_confirmed" = "gate_confirmed"): void {
    const previousSequence = this.inputSequence;
    const welcomeActive = this.isWelcomeActive();
    this.inputSequence += 1;
    voiceTrace.record("uplink", {
      new_turn: true,
      sequence: this.inputSequence,
      previous_sequence: previousSequence,
      reason: source,
      welcome_active: welcomeActive,
    });
    if (welcomeActive) {
      voiceTrace.record("guide", {
        welcome: "cancelled",
        attempt: this.welcomeAttemptId,
        reason: source,
        successor_sequence: this.inputSequence,
      });
      this.welcomeAttemptId += 1;
      this.welcomePhase = "failed";
    }
    this.hooks.onNewInput?.();
    this.releaseQaLease();
    this.soundOwner = "qa";
    const sequence = this.inputSequence;
    this.qaLease = { sequence, lease: this.focus.claim("qa", () => this.voice?.interrupt()) };
    const voice = this.voice;
    void voice?.beginTurn().catch((error: unknown) => {
      if (this.disposed || sequence !== this.inputSequence || this.voice !== voice) return;
      this.hooks.onStatus(error instanceof Error ? error.message : "语音连接失败");
    });
  }
  endTurn(): void { this.voice?.endTurn(); }
  sendFrame(pcm: ArrayBuffer): void { this.voice?.sendFrame(pcm); }

  async noteClickInspection(artifactId: string, revision: number): Promise<void> {
    if (this.disposed || !artifactId) return;
    if (!this.guide.noteInspection(artifactId, revision, "click")) return;
    await this.speakFocusedArtifact(this.inputSequence, revision);
  }

  private async control(result: VoiceControlResult): Promise<void> {
    if (this.disposed) return;
    const sequence = this.inputSequence;
    if (result.kind === "story_request" && result.story_request) {
      if (this.qaLease?.sequence === sequence) this.releaseQaLease();
      await this.guide.handleStoryRequest(result.story_request, result.utterance_id || result.story_request.utterance_id);
      return;
    }
    // The one-shot microphone turn has yielded a result. Releasing its focus
    // before mounting story autoplay keeps the already-bound XiaoZhi socket
    // alive; otherwise the narrator's focus claim called interrupt(), closed
    // that socket, and made automatic fixed-story playback fail immediately.
    if (this.qaLease?.sequence === sequence) this.releaseQaLease();
    if (result.kind === "error" || result.kind === "clarification") {
      this.hooks.onStatus(result.message ?? "请再说具体一些");
      await this.speakControlMessage(result.message ?? "请再说具体一些", sequence);
      return;
    }
    if (result.kind === "resume") {
      this.hooks.onStatus("正在从刚才停下的同一幕继续");
      if (!(await this.narration.resume())) this.hooks.onStatus("当前没有被打断的讲解片段，画面仍停在这一幕");
      return;
    }
    if (result.kind === "narration" && result.narration) {
      await this.speakFocusedArtifact(sequence, undefined, result.narration);
      return;
    }
    if (result.presentation_action) {
      const current = await refreshSession(this.session);
      const currentFocus = current.context.focused_artifact?.id;
      const expectedFocus = result.presentation_expected_focus_id;
      const expectedRevision = result.presentation_expected_revision;
      if (this.disposed || sequence !== this.inputSequence || current.context.mode !== "explore"
        || !expectedFocus || currentFocus !== expectedFocus || expectedRevision === undefined
        || current.context.revision !== expectedRevision || current.state.revision !== expectedRevision) {
        if (result.presentation_request_id) this.voice?.acknowledgeRender(result.presentation_request_id, "pending");
        return;
      }
      const status = await this.hooks.onPresentation?.(result.presentation_action) ?? "pending";
      if (this.disposed || sequence !== this.inputSequence) {
        if (result.presentation_request_id) this.voice?.acknowledgeRender(result.presentation_request_id, "pending");
        return;
      }
      if (result.presentation_request_id) this.voice?.acknowledgeRender(result.presentation_request_id, status);
      this.hooks.onStatus(status === "rendered"
        ? (result.presentation_action === "return_to_overview"
          ? "已回到展厅全景"
          : (result.message ?? "展厅视角已更新"))
        : "展厅视角尚未完成渲染，请稍后再试");
      if (status === "rendered" && result.presentation_action === "focus_current") {
        this.guide.noteInspection(expectedFocus, expectedRevision ?? 0, "voice");
        await this.speakFocusedArtifact(sequence, expectedRevision);
      } else if (status === "rendered") {
        await this.speakControlMessage("已回到展厅远观。可以说下一组文物，或说出想看的文物名称。", sequence);
      }
      return;
    }
    if (result.receipt) {
      const action = result.receipt.action ?? "";
      const expectsRenderedFrame = result.receipt.status === "committed" && isRenderGatedAction(action);
      if (expectsRenderedFrame) {
        this.narration.leave();
      }
      this.hooks.onStatus(result.message ?? "动作已提交，正在更新画面");
      const renderStatus = await this.hooks.onRefresh(result.receipt);
      if (expectsRenderedFrame) {
        if (sequence !== this.inputSequence || this.disposed) return;
        this.voice?.acknowledgeRender(result.receipt.request_id, renderStatus);
        if (renderStatus !== "rendered") {
          this.hooks.onStatus("展品画面尚未得到真实呈现回执，本轮讲解已取消；可以稍后再问");
          await this.speakControlMessage("画面还没有切换完成，我还没有带你过去。请稍后再试。", sequence);
          return;
        }
        if (isOverviewWindowAction(action)) {
          this.soundOwner = "overview";
          this.hooks.onStatus("已转到下一组总览，仍在远观，不会开始单件介绍");
          await this.speakControlMessage("已切换展厅总览。你想走近哪一件文物？", sequence);
          return;
        }
        if (isCloseUpIntroAction(action)) {
          this.hooks.onStatus("展品已呈现，讲解员正在介绍它并提供后续选择");
          const current = await refreshSession(this.session);
          const focusedId = current.context.focused_artifact?.id;
          if (focusedId) this.guide.noteInspection(focusedId, result.receipt.revision ?? current.state.revision, "voice");
          await this.speakFocusedArtifact(sequence, result.receipt.revision);
        } else {
          await this.speakControlMessage(action === "return_to_exhibit"
            ? "已回到展厅远观，可以继续参观。" : "文物视角已调整。", sequence);
        }
      } else if (result.receipt.status !== "committed") {
        await this.speakControlMessage("这次没有完成切换，画面仍在原处。请换一种说法再试。", sequence);
      }
    }
    const committedAction = result.receipt?.status === "committed" ? result.receipt.action ?? "" : "";
    const storyTransition = ["enter_story", "continue_story"].includes(committedAction);
    if ((storyTransition || committedAction === "return_to_exhibit")
      && sequence === this.inputSequence && !this.disposed) {
      this.hooks.onStoryTransition?.(committedAction);
    }
    if (result.narration && !storyTransition && !this.disposed && sequence === this.inputSequence) {
      await this.speakFocusedArtifact(sequence, result.receipt?.revision, result.narration);
    }
  }

  private async speakControlMessage(text: string, sequence: number, requireControlledReply = true): Promise<void> {
    if (this.disposed || sequence !== this.inputSequence) return;
    if (requireControlledReply && !this.voice?.hasControlledReply?.()) return;
    try {
      await this.narration.play({
        packId: this.session.pack_id, version: this.session.version,
        contentId: `museum.control.${sequence}`, role: "answer", text,
      });
    } catch (error) {
      if (!this.disposed && sequence === this.inputSequence) this.hooks.onStatus(
        error instanceof Error ? error.message : "操作结果未能播报",
      );
    }
  }

  private async speakFocusedArtifact(
    sequence: number, expectedRevision?: number,
    expectedNarration?: NonNullable<VoiceControlResult["narration"]>,
  ): Promise<void> {
    this.soundOwner = "fixed";
    this.hooks.onStatus("展品已定位，正在准备当前文物的固定讲解稿");
    try {
      const current = await refreshSession(this.session);
      const artifact = current.context.focused_artifact;
      if (sequence !== this.inputSequence || this.disposed
        || current.context.revision !== current.state.revision
        || (expectedRevision !== undefined && current.state.revision !== expectedRevision)
        || current.context.story_node || !artifact) return;

      const page = await readStoryNode(current, artifact.id, AbortSignal.timeout(8000));
      const paragraph = page.paragraphs[0];
      const backgroundId = artifact.presentation?.background_node_id;
      const authoredStoryId = paragraph?.authorship.story_id;
      const openableStories = artifact.story_entry_ids ?? [];
      if (sequence !== this.inputSequence || this.disposed
        || page.content_id !== artifact.id || page.pack_id !== current.pack_id
        || page.version !== current.version || page.artifact_id !== artifact.id
        || page.content_kind !== "background" || !backgroundId
        || !paragraph || paragraph.content_id !== backgroundId
        || paragraph.authorship.node_id !== backgroundId
        || !authoredStoryId
        || (openableStories.length > 0 && !openableStories.includes(authoredStoryId))
        || (expectedNarration && (page.pack_id !== expectedNarration.packId
          || page.version !== expectedNarration.version || paragraph.content_id !== expectedNarration.contentId
          || paragraph.text !== expectedNarration.text))) {
        throw new Error("当前文物的背景节点或故事归属不一致，已阻止串讲");
      }

      const beforePlayback = await refreshSession(current);
      if (sequence !== this.inputSequence || this.disposed
        || beforePlayback.context.revision !== beforePlayback.state.revision
        || beforePlayback.state.revision !== current.state.revision
        || beforePlayback.context.focused_artifact?.id !== artifact.id
        || beforePlayback.context.story_node) return;

      this.hooks.onStatus("展品已就位，小智正在讲解固定正文");
      const completed = await this.narration.play({
        packId: page.pack_id, version: page.version, contentId: paragraph.content_id,
        text: paragraph.text, role: "answer",
      });
      if (!completed || sequence !== this.inputSequence || this.disposed) return;

      const after = await refreshSession(current);
      const stillCurrent = after.context.revision === after.state.revision
        && after.state.revision === current.state.revision
        && after.context.focused_artifact?.id === artifact.id
        && after.context.story_node === null;
      if (!stillCurrent || sequence !== this.inputSequence || this.disposed) return;
      const storyId = artifact.story_entry_ids?.[0];
      if (storyId) {
        this.hooks.onStatus("展品介绍完成，小智正在邀请你进入故事");
        const invitationText = "想听它背后的故事吗？";
        const unsubscribe = this.narration.subscribe((checkpoint, segment) => {
          if (checkpoint.state === "playing" && segment?.contentId === artifact.id
            && segment.text === invitationText && sequence === this.inputSequence && !this.disposed) {
            this.guide.markOfferAudible(artifact.id, storyId, after.state.revision);
          }
        });
        let invitationCompleted: boolean;
        try {
          invitationCompleted = await this.narration.play({
            packId: current.pack_id, version: current.version, contentId: artifact.id,
            role: "answer", text: invitationText,
          });
        } finally {
          unsubscribe();
        }
        if (!invitationCompleted) {
          voiceTrace.record("guide", { offer: "not_audible", artifact_id: artifact.id });
        }
      } else {
        this.hooks.onStatus("展品介绍完成，可以继续参观或提问");
      }
    } catch (error) {
      if (sequence !== this.inputSequence || this.disposed) return;
      if (error instanceof ApiRequestError && error.status === 403 && error.message.includes("绑定已失效")) {
        this.hooks.onStatus(error.message);
        return;
      }
      this.hooks.onStatus(error instanceof Error
        ? `文物已定位，但小智没有完成自动讲解：${error.message}`
        : "文物已定位，但小智没有完成自动讲解");
    }
  }

  private releaseQaLease(): void {
    this.qaLease?.lease.release();
    this.qaLease = null;
    if (this.soundOwner === "qa") this.soundOwner = "idle";
  }

  dispose(): void {
    this.inputSequence += 1;
    this.welcomeAttemptId += 1;
    this.welcomePhase = "idle";
    this.disposed = true;
    this.hooks.onNewInput?.();
    this.releaseQaLease();
    this.narration.stop();
    this.focus.stop();
    this.detachNarration?.(); this.detachNarration = null;
    this.voice?.disconnect();
    this.voice = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    this.releaseNarration();
  }
}

function classifyWelcomeFailure(error: unknown, interrupted: boolean): { reason: string; message: string } {
  const raw = error instanceof Error ? error.message : "";
  if (interrupted || /已中断|已被新的语音轮次替换/.test(raw)) {
    return {
      reason: "user_manual_interrupt",
      message: "入馆欢迎语被手动打断，可以直接说“可以”进入或提问",
    };
  }
  if (/首音/.test(raw)) {
    return {
      reason: "welcome_start_timeout",
      message: "入馆欢迎语等待首音超时，可重试开启语音或直接说“可以”进入",
    };
  }
  if (/字幕/.test(raw)) {
    return {
      reason: "subtitle_mismatch",
      message: "入馆欢迎语字幕与固定正文不一致，可重试开启语音或直接说“可以”进入",
    };
  }
  if (/连接已关闭|语音连接/.test(raw)) {
    return {
      reason: "connection_closed",
      message: "入馆欢迎语时语音连接已关闭，请重新开启语音",
    };
  }
  if (/超时|无进展/.test(raw)) {
    return {
      reason: "audio_stalled",
      message: "入馆欢迎语音频无进展，可重试开启语音或直接说“可以”进入",
    };
  }
  return {
    reason: "welcome_incomplete",
    message: raw || "入馆欢迎语未能完整播放，可重试开启语音或直接说“可以”进入",
  };
}

export { isStoryOfferConsent };
