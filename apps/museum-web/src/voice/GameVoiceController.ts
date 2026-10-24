import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import type { AudioFocus } from "../narration/AudioFocus";
import type { NarrationPlayer } from "../narration/NarrationPlayer";
import { acquireSessionNarration } from "../narration/sessionNarration";
import { PlaybackQueue } from "./PlaybackQueue";
import { VoiceClient } from "./VoiceClient";
import type { VoiceControlResult } from "./VoiceClient";

export interface GameVoiceHooks {
  onStatus(message: string): void;
  onTranscript(text: string): void;
  onRefresh(receipt?: CommandReceipt): Promise<void>;
}

/** One current game session; never creates or pairs another session. */
export class GameVoiceController {
  private audio: AudioContext | null = null;
  private voice: VoiceClient | null = null;
  private readonly focus: AudioFocus;
  private readonly narration: NarrationPlayer;
  private readonly releaseNarration: () => void;
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
    const response = await fetch(`${this.bridgeUrl}/voice/bind`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ base_url: this.gameUrl, session_id: this.session.session_id,
        session_token: this.session.session_token, connection_id: this.session.connection_id }),
    });
    if (!response.ok) throw new Error("当前展台语音绑定失败，请确认游戏与语音服务已启动");
    const result = await response.json() as { binding_id: string };
    if (this.disposed) return;
    const healthResponse = await fetch(`${this.bridgeUrl}/voice/status`, { signal: AbortSignal.timeout(8000) });
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
      onText: (type, text) => { if (type === "stt" && !this.disposed) this.hooks.onTranscript(text); },
      onControl: (control) => { void this.control(control).catch((error: unknown) => {
        if (!this.disposed) this.hooks.onStatus(error instanceof Error ? error.message : "语音操作失败");
      }); },
    }, `${this.bridgeUrl.replace(/^http/, "ws")}/voice/ws`, result.binding_id);
    this.hooks.onStatus("展台已绑定，开始说话即可连接讲解员");
  }

  beginTurn(): void {
    this.inputSequence += 1;
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
      if (["locate_artifact", "move_next", "move_previous", "return_to_exhibit"].includes(result.receipt.action ?? "")) {
        this.narration.leave();
      }
      this.hooks.onStatus(result.message ?? "动作已提交，正在更新画面");
      await this.hooks.onRefresh(result.receipt);
    }
    const storyTransition = ["enter_story", "continue_story"].includes(result.receipt?.action ?? "");
    if (result.narration && !storyTransition && !this.disposed && sequence === this.inputSequence) {
      this.hooks.onTranscript(result.narration.text);
      this.hooks.onStatus("正在朗读已准备的正文");
      await this.narration.play({ ...result.narration, role: "answer" });
    }
  }

  dispose(): void {
    this.inputSequence += 1;
    this.disposed = true;
    this.narration.stop();
    this.focus.stop();
    this.voice?.disconnect();
    this.voice = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    this.releaseNarration();
  }
}
