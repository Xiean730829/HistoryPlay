import { readStoryNode, refreshSession } from "../application/museumApi";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import type { AudioFocus, AudioLease } from "../narration/AudioFocus";
import type { NarrationPlayer } from "../narration/NarrationPlayer";
import { acquireSessionNarration, attachSessionNarrationTransport } from "../narration/sessionNarration";
import { PlaybackQueue } from "./PlaybackQueue";
import { VoiceClient } from "./VoiceClient";
import type { VoiceControlResult } from "./VoiceClient";

export interface GameVoiceHooks {
  onStatus(message: string): void;
  onTranscript(text: string): void;
  onUserTranscript?(text: string): void;
  onNewInput?(): void;
  onStoryTransition?(action: string): void;
  onRefresh(receipt?: CommandReceipt): Promise<"rendered" | "degraded" | "pending">;
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
  private disposed = false;
  private inputSequence = 0;

  constructor(private readonly session: ActiveSession, private readonly hooks: GameVoiceHooks,
    private readonly gameUrl = "http://127.0.0.1:8781",
    private readonly bridgeUrl = "http://127.0.0.1:8782") {
    const runtime = acquireSessionNarration(session.session_id);
    this.focus = runtime.focus;
    this.narration = runtime.player;
    this.releaseNarration = runtime.release;
  }

  async initialize(): Promise<void> {
    this.disposed = false;
    this.audio = new AudioContext();
    await this.audio.resume();
    this.hooks.onStatus("正在连接当前展台语音");
    const entryResponse = await fetch(`${this.bridgeUrl}/voice/entry`, { signal: AbortSignal.timeout(8000) });
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
    const response = await fetch(`${this.bridgeUrl}/voice/bind`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ base_url: this.gameUrl, session_id: this.session.session_id,
        session_token: this.session.session_token, connection_id: this.session.connection_id }),
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error("当前网页来源未获本机语音桥授权，请从配置的唯一展台入口打开");
      throw new Error("当前展台语音绑定失败，请确认游戏与语音服务已启动");
    }
    const result = await response.json() as { binding_id: string };
    if (this.disposed) return;
    const healthResponse = await fetch(`${this.bridgeUrl}/voice/status`, { signal: AbortSignal.timeout(8000) });
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
          this.hooks.onUserTranscript?.(text);
        }
        else if (type === "tts" && state !== "start") this.hooks.onTranscript(text);
        else if (type === "tts" && state === "start") this.hooks.onStatus("讲解员正在结合当前展台内容回答");
      },
      onControl: (control) => { void this.control(control).catch((error: unknown) => {
        if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "语音操作失败");
      }); },
    }, `${this.bridgeUrl.replace(/^http/, "ws")}/voice/ws`, result.binding_id);
    this.detachNarration = attachSessionNarrationTransport(this.session.session_id, {
      narrate: (prompt, expected, signal, onStarted) => this.voice
        ? this.voice.speakFixedText(prompt, expected, signal, onStarted)
        : Promise.reject(new Error("当前小智语音连接已关闭")),
    });
    await this.voice.connect();
    this.hooks.onStatus("小智讲解员已连接；固定故事讲述以实际字幕和音频完成状态推进");
  }

  async speakWelcome(): Promise<void> {
    if (!this.voice) throw new Error("小智讲解员尚未连接");
    this.hooks.onStatus("小智正在介绍博物馆入口");
    const completed = await this.narration.play({
      packId: this.session.pack_id,
      version: this.session.version,
      contentId: "museum.portal.welcome",
      role: "answer",
      text: "欢迎来到时空博物馆，要我带你进去沿着时间长河欣赏文物的发展吗？",
    });
    if (!completed) throw new Error("入馆欢迎语未能完整播放");
    this.hooks.onStatus("欢迎语已播完，请说“可以”进入博物馆");
  }

  beginTurn(): void {
    this.inputSequence += 1;
    this.hooks.onNewInput?.();
    this.releaseQaLease();
    const sequence = this.inputSequence;
    this.qaLease = { sequence, lease: this.focus.claim("qa", () => this.voice?.interrupt()) };
    void this.voice?.beginTurn().catch((error: unknown) => {
      if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "语音连接失败");
    });
  }
  endTurn(): void { this.voice?.endTurn(); }
  sendFrame(pcm: ArrayBuffer): void { this.voice?.sendFrame(pcm); }

  private async control(result: VoiceControlResult): Promise<void> {
    if (this.disposed) return;
    const sequence = this.inputSequence;
    // The one-shot microphone turn has yielded a result. Releasing its focus
    // before mounting story autoplay keeps the already-bound XiaoZhi socket
    // alive; otherwise the narrator's focus claim called interrupt(), closed
    // that socket, and made automatic fixed-story playback fail immediately.
    if (this.qaLease?.sequence === sequence) this.releaseQaLease();
    if (result.kind === "error" || result.kind === "clarification") {
      this.hooks.onStatus(result.message ?? "请再说具体一些"); return;
    }
    if (result.kind === "resume") {
      if (!(await this.narration.resume())) this.hooks.onStatus("当前没有被打断的讲解片段");
      return;
    }
    if (result.receipt) {
      const expectsRenderedFrame = result.receipt.status === "committed"
        && ["locate_artifact", "move_next", "move_previous", "return_to_exhibit", "set_view"]
          .includes(result.receipt.action ?? "");
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
          return;
        }
        this.hooks.onStatus("展品已呈现，讲解员正在介绍它并提供后续选择");
        if (["locate_artifact", "move_next", "move_previous"].includes(result.receipt.action ?? "")) {
          await this.speakFocusedArtifact(sequence, result.receipt.revision);
        }
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

  private async speakFocusedArtifact(
    sequence: number, expectedRevision?: number,
    expectedNarration?: NonNullable<VoiceControlResult["narration"]>,
  ): Promise<void> {
    this.hooks.onStatus("展品已定位，正在准备当前文物的固定讲解稿");
    try {
      const current = await refreshSession(this.session);
      const artifact = current.context.focused_artifact;
      if (sequence !== this.inputSequence || this.disposed
        || current.context.revision !== current.state.revision
        || (expectedRevision !== undefined && current.state.revision !== expectedRevision)
        || current.context.story_node
        || !artifact || (expectedNarration && artifact.id !== expectedNarration.contentId)) return;

      const page = await readStoryNode(current, artifact.id, AbortSignal.timeout(8000));
      const paragraph = page.paragraphs[0];
      if (sequence !== this.inputSequence || this.disposed
        || page.content_id !== artifact.id || page.pack_id !== current.pack_id
        || page.version !== current.version || page.artifact_id !== artifact.id
        || !paragraph || paragraph.content_id !== artifact.id
        || paragraph.authorship.story_id !== null
        || (expectedNarration && (page.pack_id !== expectedNarration.packId
          || page.version !== expectedNarration.version || paragraph.text !== expectedNarration.text))) {
        return;
      }

      const beforePlayback = await refreshSession(current);
      if (sequence !== this.inputSequence || this.disposed
        || beforePlayback.context.revision !== beforePlayback.state.revision
        || beforePlayback.state.revision !== current.state.revision
        || beforePlayback.context.focused_artifact?.id !== artifact.id
        || beforePlayback.context.story_node) return;

      this.hooks.onStatus("展品已就位，小智正在讲解固定正文");
      const completed = await this.narration.play({
        packId: page.pack_id, version: page.version, contentId: page.content_id,
        text: paragraph.text, role: "answer",
      });
      if (!completed || sequence !== this.inputSequence || this.disposed) return;

      const after = await refreshSession(current);
      const stillCurrent = after.context.revision === after.state.revision
        && after.state.revision === current.state.revision
        && after.context.focused_artifact?.id === artifact.id
        && after.context.story_node === null;
      if (!stillCurrent || sequence !== this.inputSequence || this.disposed) return;
      if ((artifact.story_entry_ids ?? []).length > 0) {
        this.hooks.onStatus("展品介绍完成，小智正在邀请你进入故事");
        await this.narration.play({
          packId: current.pack_id,
          version: current.version,
          contentId: artifact.id,
          role: "answer",
          text: "这件文物有一个已发布的故事。你可以说“进入故事”，我会直接从第一幕开始讲解。",
        });
      } else {
        this.hooks.onStatus("展品介绍完成，可以继续参观或提问");
      }
    } catch (error) {
      if (sequence !== this.inputSequence || this.disposed) return;
      this.hooks.onStatus(error instanceof Error
        ? `文物已定位，但小智没有完成自动讲解：${error.message}`
        : "文物已定位，但小智没有完成自动讲解");
    }
  }

  private releaseQaLease(): void {
    this.qaLease?.lease.release();
    this.qaLease = null;
  }

  dispose(): void {
    this.inputSequence += 1;
    this.disposed = true;
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
