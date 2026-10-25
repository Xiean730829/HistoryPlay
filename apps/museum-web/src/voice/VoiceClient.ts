import { PlaybackQueue } from "./PlaybackQueue";
import type { CommandReceipt } from "@history-play/contracts";
import type { NarrationSegment } from "../narration/NarrationPlayer";

export interface VoiceControlResult {
  kind: "action" | "narration" | "resume" | "clarification" | "error";
  message?: string;
  receipt?: CommandReceipt;
  narration?: NarrationSegment;
  render_status?: "pending";
}

export type RenderAcknowledgement = "rendered" | "degraded" | "pending";

export interface VoiceCallbacks {
  onState(state: "connecting" | "connected" | "disconnected" | "error", message?: string): void;
  onText(type: "stt" | "tts" | "llm", text: string, state?: string): void;
  onControl?(result: VoiceControlResult): void;
}

interface FixedNarration {
  expected: string;
  subtitles: string[];
  epoch: number;
  audioFrames: number;
  started: boolean;
  onStarted(): void;
  finish(error?: Error): void;
  signal: AbortSignal;
  abort(): void;
  timer: ReturnType<typeof setTimeout>;
}

const BRIDGE_STAGE_LABELS: Record<string, string> = {
  browser_websocket_upgrade: "浏览器到本机语音桥",
  browser_bind_message: "展台语音绑定",
  game_begin: "展厅语音授权",
  audio_codec_initialize: "音频编解码初始化",
  upstream_websocket_connect: "讲解员服务连接",
  upstream_hello_send: "讲解员设备握手发送",
  upstream_hello_wait: "讲解员设备握手响应",
  browser_ready: "通知网页语音已就绪",
  active_voice_session: "语音会话",
};

function bridgeFailureMessage(stage: unknown, code: unknown): string {
  const safeStage = typeof stage === "string"
    && Object.prototype.hasOwnProperty.call(BRIDGE_STAGE_LABELS, stage)
    ? BRIDGE_STAGE_LABELS[stage]
    : "本机语音桥";
  const safeCode = typeof code === "string" && /^[a-z0-9_]{1,48}$/.test(code)
    ? code
    : "bridge_error";
  return `语音连接失败：${safeStage}（${safeCode}）`;
}

/** Device secrets stay in the local bridge. Every socket has its own local generation. */
export class VoiceClient {
  private socket: WebSocket | null = null;
  private connection = 0;
  private ready = false;
  private listening = false;
  private pending: ArrayBuffer[] = [];
  private preRoll: ArrayBuffer[] = [];
  private turnRequested = false;
  private turnEnded = false;
  private closing: Promise<void> = Promise.resolve();
  private fixedNarration: FixedNarration | null = null;
  private providerSpeaking = false;
  private readonly providerIdleWaiters = new Set<() => void>();

  constructor(
    private readonly playback: PlaybackQueue,
    private readonly callbacks: VoiceCallbacks,
    private readonly endpoint = "ws://127.0.0.1:8782/voice/ws",
    private readonly bindingId?: string,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1"
      || url.pathname !== "/voice/ws" || url.search || url.hash || url.username || url.password) {
      throw new Error("语音客户端只允许连接本机受控语音桥");
    }
  }

  connect(): Promise<void> {
    const preRoll = this.pending.slice();
    const recent = this.preRoll.slice();
    const turnRequested = this.turnRequested;
    const turnEnded = this.turnEnded;
    this.disconnect();
    this.pending = preRoll;
    this.preRoll = recent;
    this.turnRequested = turnRequested;
    this.turnEnded = turnEnded;
    const connection = this.connection;
    const epoch = this.playback.epoch;
    const endpointUrl = new URL(this.endpoint);
    const safeEndpoint = `${endpointUrl.protocol}//127.0.0.1${endpointUrl.port ? `:${endpointUrl.port}` : ""}${endpointUrl.pathname}`;
    this.callbacks.onState("connecting", `正在连接本机语音桥：${safeEndpoint}`);
    const socket = new WebSocket(this.endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    let upgraded = false;
    let stage: "websocket_upgrade" | "browser_bind_message" | "bridge_ready" = "websocket_upgrade";
    socket.onopen = () => {
      if (connection !== this.connection) return;
      upgraded = true;
      stage = "browser_bind_message";
      this.callbacks.onState("connecting", "本机WebSocket已升级，正在发送展台绑定");
      if (this.bindingId && connection === this.connection) {
        socket.send(JSON.stringify({ op: "bind", binding_id: this.bindingId }));
        stage = "bridge_ready";
        this.callbacks.onState("connecting", "展台绑定已发送，正在等待讲解员就绪");
      }
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        const message = stage === "websocket_upgrade"
          ? "语音连接失败：浏览器WebSocket代理（upgrade_timeout）"
          : stage === "browser_bind_message"
            ? "语音连接失败：展台绑定消息（bind_send_timeout）"
            : "语音连接失败：本机语音桥就绪（ready_timeout）";
        fail(new Error(message));
        this.disconnect();
      }, 30000);
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (connection !== this.connection) return;
        if (typeof event.data === "string") {
          let data: {
            type?: string;
            state?: string;
            text?: string;
            result?: VoiceControlResult;
            stage?: unknown;
            code?: unknown;
          };
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.type === "ready") {
            this.ready = true;
            clearTimeout(timer);
            settled = true;
            this.callbacks.onState("connected");
            resolve();
          } else if (data.type === "control" && data.result) {
            this.callbacks.onControl?.(data.result);
          } else if (data.type === "bridge_error") {
            const message = bridgeFailureMessage(data.stage, data.code);
            fail(new Error(message));
            this.callbacks.onState("error", message);
          } else if (data.type === "tts") {
            const fixed = this.fixedNarration;
            if (fixed && fixed.epoch === epoch) {
              if (data.state === "start") { fixed.started = true; fixed.onStarted(); }
              else if (data.state === "stop") {
                const actual = normalizeNarrationText(fixed.subtitles.join(""));
                const expected = normalizeNarrationText(fixed.expected);
                if (!fixed.started || !fixed.audioFrames) {
                  fixed.finish(new Error("小智未返回完整本段音频，故事不会自动翻页")); this.interrupt();
                }
                else if (!actual || actual !== expected) {
                  fixed.finish(new Error("小智语音字幕与固定正文不一致，故事不会自动翻页")); this.interrupt();
                }
                else this.playback.onDrained(epoch, () => fixed.finish());
              } else if (typeof data.text === "string" && data.text.trim()
                && data.state !== "sentence_end" && data.state !== "end") {
                const text = data.text.trim();
                if (fixed.subtitles.at(-1) !== text) fixed.subtitles.push(text);
              }
            } else if (data.state === "start") {
              this.providerSpeaking = true;
            } else if (data.state === "stop" && this.providerSpeaking) {
              this.playback.onDrained(epoch, () => {
                this.providerSpeaking = false;
                const waiters = [...this.providerIdleWaiters];
                this.providerIdleWaiters.clear();
                waiters.forEach((notify) => notify());
              });
            }
            this.callbacks.onText("tts", data.text ?? "", data.state);
          } else if (data.type === "stt" || data.type === "llm") {
            this.callbacks.onText(data.type, data.text ?? "", data.state);
          }
        } else if (event.data.byteLength >= 6 && (event.data.byteLength - 4) % 2 === 0) {
          const sampleRate = new DataView(event.data).getUint32(0, false);
          const pcm = new Int16Array(event.data.slice(4));
          const accepted = this.playback.enqueue(pcm, sampleRate, epoch);
          if (accepted && this.fixedNarration?.epoch === epoch) this.fixedNarration.audioFrames += 1;
        }
      };
      socket.onclose = (event) => {
        fail(new Error(upgraded
          ? `语音连接失败：本机语音桥（closed_${event?.code ?? 1006}）`
          : `语音连接失败：浏览器WebSocket代理（closed_${event?.code ?? 1006}）`));
        if (connection !== this.connection) return;
        this.socket = null;
        this.ready = false;
        this.listening = false;
        this.clearProviderSpeechWaiters();
        this.pending = [];
        this.turnRequested = false;
        this.turnEnded = false;
        this.playback.stop();
        this.callbacks.onState("disconnected");
      };
      socket.onerror = () => {
        fail(new Error(upgraded
          ? "语音连接失败：本机语音桥（socket_error）"
          : "语音连接失败：浏览器WebSocket代理（upgrade_error）"));
      };
    });
  }

  startListening(): void {
    if (!this.ready) throw new Error("请先连接本机语音桥");
    this.socket?.send(JSON.stringify({ op: "start", mode: "manual" }));
    this.listening = true;
    for (const frame of this.pending) this.socket?.send(frame);
    this.pending = [];
  }

  sendFrame(frame: ArrayBuffer): void {
    if (frame.byteLength !== 640) return;
    this.preRoll.push(frame.slice(0));
    if (this.preRoll.length > 12) this.preRoll.shift();
    if (this.ready && this.listening) this.socket?.send(frame);
    else if (this.turnRequested && !this.turnEnded) {
      this.pending.push(frame.slice(0));
      if (this.pending.length > 1500) {
        this.disconnect();
        this.callbacks.onState("error", "连接等待期间单段语音超过30秒，请重新说一次");
      }
    } else if (!this.turnRequested) {
      this.pending = this.preRoll.slice();
    }
  }

  /** One trusted local utterance per transport; buffers up to 30s while reconnecting. */
  async beginTurn(): Promise<void> {
    const preRoll = this.preRoll.slice();
    this.interrupt();
    this.pending = preRoll;
    this.turnRequested = true;
    this.turnEnded = false;
    // The bridge has a single-device lease. Wait for its close acknowledgement
    // before opening the replacement, otherwise the old lease can cause HTTP409.
    await this.closing;
    const opening = this.connect();
    const connection = this.connection;
    await opening;
    if (connection !== this.connection) return;
    this.startListening();
    if (this.turnEnded) {
      this.stopListening();
      this.turnRequested = false;
    }
  }

  endTurn(): void {
    this.turnEnded = true;
    if (this.ready && this.listening) {
      this.stopListening();
      this.turnRequested = false;
    }
  }

  acknowledgeRender(requestId: string, status: RenderAcknowledgement): void {
    if (!this.ready || !requestId) return;
    this.socket?.send(JSON.stringify({
      op: "render_receipt",
      request_id: requestId,
      status: status === "rendered" ? "rendered" : "degraded",
    }));
  }

  /** Sends one bounded fixed-text request over the already bound XiaoZhi transport. */
  async speakFixedText(prompt: string, expectedText: string, signal: AbortSignal, onStarted: () => void): Promise<void> {
    const value = prompt.trim();
    const expected = expectedText.trim();
    if (!this.ready || this.listening || !value || !expected || Array.from(value).length > 80) {
      throw new Error("小智固定稿通道未就绪，或本段超过单次文本长度限制");
    }
    if (signal.aborted) throw new DOMException("讲述已取消", "AbortError");
    if (this.fixedNarration) throw new Error("小智正在讲述上一段，请稍后重试");
    await this.waitForProviderSilence(signal);
    if (signal.aborted || !this.ready) throw new DOMException("讲述已取消", "AbortError");
    const socket = this.socket;
    const epoch = this.playback.epoch;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (this.fixedNarration?.finish === finish) this.fixedNarration = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => {
        finish(new DOMException("讲述已中断", "AbortError"));
        this.interrupt();
      };
      const timer = setTimeout(() => {
        finish(new Error("等待小智固定稿语音超时，故事不会自动翻页"));
        this.interrupt();
      }, 60000);
      const pending: FixedNarration = {
        expected, subtitles: [], epoch, audioFrames: 0, started: false,
        onStarted, finish, signal, abort, timer,
      };
      this.fixedNarration = pending;
      signal.addEventListener("abort", abort, { once: true });
      try { socket?.send(JSON.stringify({ op: "text", text: value })); }
      catch { finish(new Error("无法向当前小智会话发送固定稿")); }
    });
  }

  private waitForProviderSilence(signal: AbortSignal): Promise<void> {
    if (!this.providerSpeaking) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.providerIdleWaiters.delete(notify);
        if (error) reject(error); else resolve();
      };
      const notify = () => finish();
      const abort = () => finish(new DOMException("讲述已中断", "AbortError"));
      const timer = setTimeout(() => finish(new Error("上一段小智语音尚未结束")), 30000);
      signal.addEventListener("abort", abort, { once: true });
      this.providerIdleWaiters.add(notify);
    });
  }

  stopListening(): void {
    if (this.ready && this.listening) this.socket?.send(JSON.stringify({ op: "stop" }));
    this.listening = false;
  }

  /** Stop locally before abort. Reconnect explicitly; old transport cannot revive. */
  interrupt(): void {
    const preRoll = this.pending.slice();
    const recent = this.preRoll.slice();
    this.playback.stop();
    if (this.ready) this.socket?.send(JSON.stringify({ op: "abort" }));
    this.disconnect();
    this.pending = preRoll;
    this.preRoll = recent;
  }

  disconnect(): void {
    this.connection += 1;
    this.ready = false;
    this.listening = false;
    this.pending = [];
    this.preRoll = [];
    this.turnRequested = false;
    this.turnEnded = false;
    this.clearProviderSpeechWaiters();
    this.fixedNarration?.finish(new Error("小智语音连接已关闭，固定稿未完成"));
    this.playback.stop();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.closing = new Promise((resolve) => {
        const previous = socket.onclose;
        const timer = setTimeout(resolve, 2500);
        socket.onclose = (event) => {
          clearTimeout(timer);
          previous?.call(socket, event);
          resolve();
        };
        socket.close();
      });
    }
  }

  private clearProviderSpeechWaiters(): void {
    this.providerSpeaking = false;
    const waiters = [...this.providerIdleWaiters];
    this.providerIdleWaiters.clear();
    waiters.forEach((notify) => notify());
  }
}

function normalizeNarrationText(text: string): string {
  return text.normalize("NFC").replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()《》【】…—\-]/gu, "");
}
