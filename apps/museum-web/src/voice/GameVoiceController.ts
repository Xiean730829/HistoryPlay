import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import type { AudioFocus } from "../narration/AudioFocus";
import type { NarrationPlayer } from "../narration/NarrationPlayer";
import { acquireSessionNarration, attachSessionNarrationTransport } from "../narration/sessionNarration";
import { PlaybackQueue } from "./PlaybackQueue";
import { VoiceClient } from "./VoiceClient";
import type { VoiceControlResult } from "./VoiceClient";

export interface GameVoiceHooks {
  onStatus(message: string): void;
  onTranscript(text: string): void;
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
        if (type === "stt") this.hooks.onTranscript(text);
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

  beginTurn(): void {
    this.inputSequence += 1;
    this.hooks.onNewInput?.();
    this.focus.claim("qa", () => this.voice?.interrupt());
    void this.voice?.beginTurn().catch((error: unknown) => {
      if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "语音连接失败");
    });
  }
  endTurn(): void { this.voice?.endTurn(); }
  sendFrame(pcm: ArrayBuffer): void { this.voice?.sendFrame(pcm); }

  private async control(result: VoiceControlResult): Promise<void> {
    if (this.disposed) return;
    const sequence = this.inputSequence;
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
      }
    }
    const committedAction = result.receipt?.status === "committed" ? result.receipt.action ?? "" : "";
    const storyTransition = ["enter_story", "continue_story"].includes(committedAction);
    if ((storyTransition || committedAction === "return_to_exhibit")
      && sequence === this.inputSequence && !this.disposed) {
      this.hooks.onStoryTransition?.(committedAction);
    }
    if (result.narration && !storyTransition && !this.disposed && sequence === this.inputSequence) {
      // The fixed paragraph is context for XiaoZhi's live response. Never label
      // browser speech as XiaoZhi audio or silently replace the device voice.
      this.hooks.onStatus("已读取当前文物的固定讲解稿，等待讲解员实时讲解");
    }
  }

  dispose(): void {
    this.inputSequence += 1;
    this.disposed = true;
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
