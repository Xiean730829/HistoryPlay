import { PlaybackQueue } from "./PlaybackQueue";
import type { CommandReceipt } from "@history-play/contracts";
import type { NarrationSegment } from "../narration/NarrationPlayer";
import { voiceTrace } from "./VoiceTrace";

export type StoryRequestKind = "explicit_current" | "explicit_named" | "consent" | "decline";

export interface StoryRequest {
  kind: StoryRequestKind;
  utterance_id?: string;
  query?: string;
  canonical_title?: string;
  artifact_id?: string;
  candidates?: number;
}

export interface VoiceControlResult {
  kind: "action" | "narration" | "resume" | "clarification" | "error" | "story_request";
  message?: string;
  receipt?: CommandReceipt;
  narration?: NarrationSegment;
  render_status?: "pending";
  presentation_action?: "focus_current" | "return_to_overview";
  presentation_request_id?: string;
  presentation_expected_focus_id?: string;
  presentation_expected_revision?: number;
  story_request?: StoryRequest;
  utterance_id?: string;
  diagnosis?: {
    intent?: string;
    query?: string;
    canonical_title?: string;
    candidates?: number;
    candidate_ids?: string[];
    candidate_titles?: string[];
    artifact_id?: string;
    pack_id?: string;
    version?: string;
    action?: string;
    status?: string;
    reason?: string;
  };
}

export type RenderAcknowledgement = "rendered" | "degraded" | "pending";

export interface VoiceCallbacks {
  onState(state: "connecting" | "connected" | "disconnected" | "error", message?: string): void;
  onText(type: "stt" | "tts" | "llm", text: string, state?: string): void;
  onControl?(result: VoiceControlResult): void;
}

export type OriginalAnswerPhase = "idle" | "awaiting_answer" | "speaking" | "draining" | "cancelled";

interface FixedNarration {
  expected: string;
  subtitles: string[];
  epoch: number;
  connection: number;
  requestId: string;
  segmentId: string;
  chunkIndex: number;
  audioFrames: number;
  started: boolean;
  onStarted(): void;
  finish(error?: Error): void;
  signal: AbortSignal;
  abort(): void;
  timer: ReturnType<typeof setTimeout> | undefined;
  firstAudioTimer: ReturnType<typeof setTimeout> | null;
}

export interface FixedNarrationMeta {
  requestId?: string;
  segmentId?: string;
  chunkIndex?: number;
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
  private sentFrames = 0;
  private turnGeneration = 0;
  private openingTurn: Promise<void> | null = null;
  private closing: Promise<void> = Promise.resolve();
  private fixedNarration: FixedNarration | null = null;
  private providerSpeaking = false;
  private originalAnswerPhase: OriginalAnswerPhase = "idle";
  private originalAnswerGeneration = 0;
  private providerResponseGeneration = 0;
  private holdOriginal = false;
  private controlledReplyPending = false;
  private readonly providerIdleWaiters = new Set<() => void>();
  private readonly originalAnswerWaiters = new Set<() => void>();

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
    voiceTrace.setConnected(false, "connecting");
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
            event?: unknown;
            received_frames?: unknown;
            opus_packets?: unknown;
            mode?: string;
            request_id?: string;
          };
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.type === "ready") {
            this.ready = true;
            clearTimeout(timer);
            settled = true;
            voiceTrace.setConnected(true, "bridge_ready");
            this.callbacks.onState("connected");
            resolve();
          } else if (data.type === "control_policy" && data.mode === "local") {
            this.controlledReplyPending = true;
            this.playback.stop();
            voiceTrace.record("answer", { owner: "game", cloud_reply_suppressed: true });
          } else if (data.type === "control" && data.result) {
            const result = data.result;
            const utteranceId = result.utterance_id || result.story_request?.utterance_id
              || voiceTrace.snapshot()?.utteranceId;
            if (utteranceId) {
              result.utterance_id = utteranceId;
              if (result.story_request && !result.story_request.utterance_id) {
                result.story_request = { ...result.story_request, utterance_id: utteranceId };
              }
            }
            voiceTrace.record("intent", {
              kind: result.kind,
              intent: result.diagnosis?.intent ?? result.kind,
              query: result.diagnosis?.query ?? result.story_request?.query ?? null,
              canonical: result.diagnosis?.canonical_title ?? result.story_request?.canonical_title ?? null,
              candidates: result.diagnosis?.candidates ?? result.story_request?.candidates ?? null,
              artifact_id: result.diagnosis?.artifact_id ?? result.story_request?.artifact_id ?? null,
            });
            if (result.receipt) {
              voiceTrace.record("action", {
                request_id: result.receipt.request_id,
                action: result.receipt.action ?? result.diagnosis?.action ?? null,
                status: result.receipt.status,
                reason: result.receipt.reason ?? result.diagnosis?.reason ?? null,
              });
            }
            this.callbacks.onControl?.(result);
          } else if (data.type === "uplink_ack") {
            voiceTrace.record("uplink", {
              startReceived: data.event === "start" ? true : undefined,
              stopReceived: data.event === "stop" ? true : undefined,
              receivedFrames: typeof data.received_frames === "number" ? data.received_frames : null,
              opusPackets: typeof data.opus_packets === "number" ? data.opus_packets : null,
            });
          } else if (data.type === "narration_ack") {
            if (data.request_id === this.fixedNarration?.requestId) {
              voiceTrace.record("fixed", { mcp_stage: typeof data.stage === "string" ? data.stage : "unknown" });
              this.callbacks.onState("connected", "小智正在读取当前固定讲稿");
            }
          } else if (data.type === "narration_error") {
            const detail = data.code === "wake_word_only"
              ? "上游拒绝把长正文作为唤醒词，固定讲稿未能提交"
              : "小智上游拒绝本段讲稿，请检查当前MCP讲稿连接";
            this.fixedNarration?.finish(new Error(detail));
            this.callbacks.onState("error", detail);
            this.interrupt();
          } else if (data.type === "bridge_error") {
            const message = bridgeFailureMessage(data.stage, data.code);
            fail(new Error(message));
            this.callbacks.onState("error", message);
          } else if (data.type === "tts") {
            if (this.controlledReplyPending) return;
            this.handleTtsEvent(data, epoch);
            this.callbacks.onText("tts", data.text ?? "", data.state);
          } else if (data.type === "stt" || data.type === "llm") {
            if (data.type === "llm" && this.controlledReplyPending) return;
            if (data.type === "stt") {
              const text = (data.text ?? "").trim();
              voiceTrace.record("stt", { text: text || null, empty: text.length === 0 });
              if (!voiceTrace.snapshot()?.stages.uplink?.firstStt) {
                voiceTrace.record("uplink", { firstStt: true });
              }
            }
            this.callbacks.onText(data.type, data.text ?? "", data.state);
          }
        } else if (event.data.byteLength >= 6 && (event.data.byteLength - 4) % 2 === 0) {
          if (this.controlledReplyPending) return;
          const sampleRate = new DataView(event.data).getUint32(0, false);
          const pcm = new Int16Array(event.data.slice(4));
          const accepted = this.playback.enqueue(pcm, sampleRate, epoch);
          if (accepted && this.fixedNarration?.epoch === epoch) {
            const fixed = this.fixedNarration;
            if (fixed.audioFrames === 0) fixed.onStarted();
            fixed.audioFrames += 1;
          }
          if (accepted && !voiceTrace.snapshot()?.stages.uplink?.firstPlayback) {
            voiceTrace.record("uplink", { firstPlayback: true });
          }
        }
      };
      socket.onclose = (event) => {
        if (connection !== this.connection) {
          fail(new Error("语音连接已替换"));
          return;
        }
        fail(new Error(upgraded
          ? `语音连接失败：本机语音桥（closed_${event?.code ?? 1006}）`
          : `语音连接失败：浏览器WebSocket代理（closed_${event?.code ?? 1006}）`));
        this.socket = null;
        this.ready = false;
        this.listening = false;
        this.clearProviderSpeechWaiters();
        this.pending = [];
        this.turnRequested = false;
        this.turnEnded = false;
        this.playback.stop();
        voiceTrace.setConnected(false, `closed_${event?.code ?? 1006}`);
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
    voiceTrace.record("uplink", { start: true, pendingFrames: this.pending.length });
    for (const frame of this.pending) {
      this.socket?.send(frame);
      this.sentFrames += 1;
    }
    this.pending = [];
    voiceTrace.record("uplink", { start: true, sentFrames: this.sentFrames });
  }

  duckPlayback(active: boolean): void {
    this.playback.duck(active);
  }

  sendFrame(frame: ArrayBuffer): void {
    if (frame.byteLength !== 640) return;
    this.preRoll.push(frame.slice(0));
    // Auto onset uses a modulation window plus confirmation. Preserve 600ms
    // so it submits the same complete first word as a deliberate button press.
    if (this.preRoll.length > 30) this.preRoll.shift();
    if (this.ready && this.listening) {
      this.socket?.send(frame);
      this.sentFrames += 1;
    } else if (this.turnRequested && !this.turnEnded) {
      this.pending.push(frame.slice(0));
      if (this.pending.length > 1500) {
        voiceTrace.record("uplink", { cancel: true, reason: "pending_over_30s", frames: this.pending.length });
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
    const generation = ++this.turnGeneration;
    this.interrupt();
    this.pending = preRoll;
    this.turnRequested = true;
    this.turnEnded = false;
    this.sentFrames = 0;
    voiceTrace.record("uplink", { closingWait: true, pendingFrames: preRoll.length });
    const opening = this.openTurn(generation);
    this.openingTurn = opening;
    try {
      await opening;
    } finally {
      if (this.openingTurn === opening) this.openingTurn = null;
    }
  }

  private async openTurn(generation: number): Promise<void> {
    // The bridge has a single-device lease. Wait for its close acknowledgement
    // before opening the replacement, otherwise the old lease can cause HTTP409.
    await this.closing;
    if (generation !== this.turnGeneration) return;
    voiceTrace.record("uplink", { reconnect: true });
    const opening = this.connect();
    const connection = this.connection;
    try {
      await opening;
    } catch (error) {
      if (generation !== this.turnGeneration) return;
      throw error;
    }
    if (generation !== this.turnGeneration || connection !== this.connection) return;
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

  originalAnswerState(): OriginalAnswerPhase {
    return this.originalAnswerPhase;
  }

  hasControlledReply(): boolean { return this.controlledReplyPending; }

  acknowledgeRender(requestId: string, status: RenderAcknowledgement): void {
    if (!this.ready || !requestId) return;
    voiceTrace.record("render", { request_id: requestId, status });
    this.socket?.send(JSON.stringify({
      op: "render_receipt",
      request_id: requestId,
      status: status === "rendered" ? "rendered" : "degraded",
    }));
  }

  /** Sends one bounded fixed-text request over the already bound XiaoZhi transport. */
  async speakFixedText(
    prompt: string,
    expectedText: string,
    signal: AbortSignal,
    onStarted: () => void,
    meta?: FixedNarrationMeta,
  ): Promise<void> {
    const value = prompt.trim();
    const expected = expectedText.trim();
    if (this.listening || !value || !expected || Array.from(value).length > 80) {
      throw new Error("小智固定稿通道未就绪，或本段超过单次文本长度限制");
    }
    if (signal.aborted) throw new DOMException("讲述已取消", "AbortError");
    // A previous timeout can have retired only the output socket while the
    // visitor still has the microphone enabled. Story entry/retry reconnects
    // that same binding instead of silently remaining disconnected forever.
    if (!this.ready) await this.renewUnansweredTransport(signal);
    if (this.fixedNarration) throw new Error("小智正在讲述上一段，请稍后重试");
    const requestId = meta?.requestId?.trim() || localVoiceId("fixed");
    const segmentId = meta?.segmentId?.trim() || requestId;
    const chunkIndex = Number.isInteger(meta?.chunkIndex) ? meta!.chunkIndex! : 0;
    voiceTrace.record("fixed", {
      queued: true, request_id: requestId, segment_id: segmentId, chunk_index: chunkIndex,
      original_phase: this.originalAnswerPhase,
    });
    if (this.controlledReplyPending) {
      this.controlledReplyPending = false;
      await this.renewUnansweredTransport(signal);
    }
    if (this.originalAnswerPhase !== "idle" && this.originalAnswerPhase !== "cancelled") {
      await this.waitForOriginalAnswer(signal);
    }
    await this.waitForProviderSilence(signal);
    if (signal.aborted || !this.ready) throw new DOMException("讲述已取消", "AbortError");
    if (this.originalAnswerPhase !== "idle" && this.originalAnswerPhase !== "cancelled") {
      throw new Error(`原问答仍处于${this.originalAnswerPhase}，固定稿未发送`);
    }
    this.holdOriginal = true;
    const socket = this.socket;
    const epoch = this.playback.epoch;
    const connection = this.connection;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let firstAudioTimer: ReturnType<typeof setTimeout> | null = null;
      let pending!: FixedNarration;
      const clearFirstAudioWait = () => {
        if (firstAudioTimer === null) return;
        clearTimeout(firstAudioTimer);
        firstAudioTimer = null;
        if (pending) pending.firstAudioTimer = null;
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        clearFirstAudioWait();
        signal.removeEventListener("abort", abort);
        if (this.fixedNarration?.finish === finish) this.fixedNarration = null;
        this.holdOriginal = false;
        if (error) {
          voiceTrace.record("fixed", {
            request_id: requestId, segment_id: segmentId, chunk_index: chunkIndex,
            failed: true, reason: error.message.slice(0, 160),
          });
          reject(error);
        } else {
          voiceTrace.record("fixed", {
            request_id: requestId, segment_id: segmentId, chunk_index: chunkIndex, drained: true,
          });
          resolve();
        }
      };
      const abort = () => {
        voiceTrace.record("fixed", {
          request_id: requestId, interrupt: true, source: "abort_signal",
        });
        finish(new DOMException("讲述已中断", "AbortError"));
        this.interrupt();
      };
      pending = {
        expected, subtitles: [], epoch, connection, requestId, segmentId, chunkIndex,
        audioFrames: 0, started: false, onStarted: () => {
          clearFirstAudioWait();
          onStarted();
        }, finish, signal, abort, timer: undefined, firstAudioTimer: null,
      };
      timer = setTimeout(() => {
        const waitStage = pending.audioFrames > 0 ? "audio_stalled" : "first_audio";
        voiceTrace.record("fixed", {
          request_id: requestId, timeout: true, wait_stage: waitStage,
        });
        finish(new Error(pending.audioFrames > 0
          ? "小智固定稿音频无进展，故事不会自动翻页"
          : "等待小智固定稿首音超时"));
        this.interrupt();
      }, 60000);
      firstAudioTimer = setTimeout(() => {
        if (pending.audioFrames > 0) {
          clearFirstAudioWait();
          return;
        }
        voiceTrace.record("fixed", {
          request_id: requestId, timeout: true, wait_stage: "first_audio",
        });
        finish(new Error("等待小智固定稿首音超时"));
        this.interrupt();
      }, 30_000);
      pending.timer = timer;
      pending.firstAudioTimer = firstAudioTimer;
      this.fixedNarration = pending;
      signal.addEventListener("abort", abort, { once: true });
      try {
        socket?.send(JSON.stringify({ op: "text", text: value, request_id: requestId }));
        voiceTrace.record("fixed", {
          sent: true, request_id: requestId, segment_id: segmentId, chunk_index: chunkIndex,
        });
      } catch { finish(new Error("无法向当前小智会话发送固定稿")); }
    });
  }

  private waitForOriginalAnswer(signal: AbortSignal): Promise<void> {
    if (this.originalAnswerPhase === "idle" || this.originalAnswerPhase === "cancelled") {
      return Promise.resolve();
    }
    const phase = this.originalAnswerPhase;
    const limit = phase === "awaiting_answer" ? 12000 : 30000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.originalAnswerWaiters.delete(notify);
        if (error) reject(error); else resolve();
      };
      const notify = () => {
        if (this.originalAnswerPhase === "idle" || this.originalAnswerPhase === "cancelled") finish();
      };
      const abort = () => finish(new DOMException("讲述已中断", "AbortError"));
      const timer = setTimeout(() => {
        const stuck = this.originalAnswerPhase;
        voiceTrace.record("answer", {
          timeout: true, wait_stage: stuck, generation: this.originalAnswerGeneration,
        });
        this.originalAnswerWaiters.delete(notify);
        if (stuck === "awaiting_answer") {
          // A timed-out cloud reply can still arrive. Marking it idle and
          // reusing that socket misattributes its first sentence to the new
          // fixed request, then closes the voice channel on subtitle mismatch.
          void this.renewUnansweredTransport(signal).then(() => finish(), finish);
          return;
        }
        finish(new Error(`原问答仍处于${stuck}，固定稿未发送`));
      }, limit);
      signal.addEventListener("abort", abort, { once: true });
      this.originalAnswerWaiters.add(notify);
    });
  }

  private async renewUnansweredTransport(signal: AbortSignal): Promise<void> {
    this.interrupt();
    await this.closing;
    if (signal.aborted) throw new DOMException("讲述已中断", "AbortError");
    const opening = this.connect();
    const connection = this.connection;
    const abort = () => { if (this.connection === connection) this.interrupt(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await opening;
      if (signal.aborted || connection !== this.connection) {
        throw new DOMException("讲述已中断", "AbortError");
      }
      this.setOriginalAnswerPhase("idle", { source: "fresh_narration_transport" });
    } finally {
      signal.removeEventListener("abort", abort);
    }
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
      const timer = setTimeout(() => {
        voiceTrace.record("answer", { timeout: true, wait_stage: "provider_speaking" });
        finish(new Error("上一段小智语音尚未结束"));
      }, 30000);
      signal.addEventListener("abort", abort, { once: true });
      this.providerIdleWaiters.add(notify);
    });
  }

  stopListening(): void {
    if (this.ready && this.listening) {
      this.socket?.send(JSON.stringify({ op: "stop" }));
      voiceTrace.record("uplink", { stop: true, stopSent: true, sentFrames: this.sentFrames });
      this.markOriginalAnswerPending();
    }
    this.listening = false;
  }

  private markOriginalAnswerPending(): void {
    if (this.fixedNarration) return;
    if (this.originalAnswerPhase === "speaking" || this.originalAnswerPhase === "draining") return;
    this.originalAnswerGeneration += 1;
    this.setOriginalAnswerPhase("awaiting_answer");
  }

  private setOriginalAnswerPhase(phase: OriginalAnswerPhase, extra?: Record<string, string | number | boolean | null>): void {
    this.originalAnswerPhase = phase;
    voiceTrace.record("answer", {
      phase,
      generation: this.originalAnswerGeneration,
      pending: phase === "awaiting_answer",
      start: phase === "speaking",
      stop: phase === "draining",
      drained: phase === "idle",
      cancelled: phase === "cancelled",
      ...(extra ?? {}),
    });
    if (phase === "idle" || phase === "cancelled") this.notifyOriginalAnswerWaiters();
  }

  private handleTtsEvent(data: { state?: string; text?: string }, epoch: number): void {
    const state = data.state;
    const fixed = this.fixedNarration;
    const fixedActive = Boolean(
      fixed && fixed.epoch === epoch && fixed.connection === this.connection,
    );
    if (fixedActive) {
      this.handleFixedTtsEvent(fixed!, data, epoch);
      return;
    }
    if (this.originalAnswerPhase === "cancelled") return;
    if (state === "start") {
      if (this.holdOriginal && !fixedActive) return;
      this.providerResponseGeneration += 1;
      this.providerSpeaking = true;
      this.setOriginalAnswerPhase("speaking");
      return;
    }
    if (state === "stop" && (this.originalAnswerPhase === "speaking"
      || this.originalAnswerPhase === "awaiting_answer"
      || this.providerSpeaking)) {
      this.setOriginalAnswerPhase("draining");
      const responseGeneration = this.providerResponseGeneration;
      this.playback.onDrained(epoch, () => {
        if (epoch !== this.playback.epoch || responseGeneration !== this.providerResponseGeneration) return;
        this.providerSpeaking = false;
        this.setOriginalAnswerPhase("idle");
        this.notifyProviderIdleWaiters();
      });
    }
  }

  private handleFixedTtsEvent(fixed: FixedNarration, data: { state?: string; text?: string }, epoch: number): void {
    if (data.state === "start") {
      fixed.started = true;
      voiceTrace.record("fixed", {
        start: true, request_id: fixed.requestId, segment_id: fixed.segmentId, chunk_index: fixed.chunkIndex,
      });
      return;
    }
    if (data.state === "stop") {
      const actual = normalizeNarrationText(fixed.subtitles.join(""));
      const expected = normalizeNarrationText(fixed.expected);
      const subtitleMatch = Boolean(actual) && actual === expected;
      voiceTrace.record("fixed", {
        request_id: fixed.requestId, segment_id: fixed.segmentId, chunk_index: fixed.chunkIndex,
        subtitle_match: subtitleMatch, audio_frames: fixed.audioFrames, started: fixed.started,
      });
      if (!fixed.started || !fixed.audioFrames) {
        fixed.finish(new Error("小智未返回完整本段音频，故事不会自动翻页")); this.interrupt();
      } else if (!subtitleMatch) {
        fixed.finish(new Error("小智语音字幕与固定正文不一致，故事不会自动翻页")); this.interrupt();
      } else {
        this.playback.onDrained(epoch, () => fixed.finish());
      }
      return;
    }
    if (typeof data.text === "string" && data.text.trim()
      && data.state !== "sentence_end" && data.state !== "end") {
      const text = data.text.trim();
      if (fixed.subtitles.at(-1) !== text) fixed.subtitles.push(text);
    }
  }

  /** Stop locally before abort. Reconnect explicitly; old transport cannot revive. */
  interrupt(): void {
    if (this.turnRequested && !this.turnEnded) {
      voiceTrace.record("uplink", { cancel: true, reason: "interrupt", sentFrames: this.sentFrames });
    }
    if (this.originalAnswerPhase !== "idle") {
      this.setOriginalAnswerPhase("cancelled", { source: "interrupt" });
    }
    const preRoll = this.pending.slice();
    const recent = this.preRoll.slice();
    this.playback.stop();
    if (this.ready) this.socket?.send(JSON.stringify({ op: "abort" }));
    this.disconnect();
    this.pending = preRoll;
    this.preRoll = recent;
  }

  disconnect(): void {
    this.controlledReplyPending = false;
    this.connection += 1;
    this.ready = false;
    this.listening = false;
    this.pending = [];
    this.preRoll = [];
    this.turnRequested = false;
    this.turnEnded = false;
    if (this.originalAnswerPhase !== "idle" && this.originalAnswerPhase !== "cancelled") {
      this.setOriginalAnswerPhase("cancelled", { source: "disconnect" });
    }
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
    this.providerResponseGeneration += 1;
    this.providerSpeaking = false;
    const waiters = [...this.providerIdleWaiters];
    this.providerIdleWaiters.clear();
    waiters.forEach((notify) => notify());
    this.notifyOriginalAnswerWaiters();
  }

  private notifyProviderIdleWaiters(): void {
    if (this.providerSpeaking) return;
    const waiters = [...this.providerIdleWaiters];
    this.providerIdleWaiters.clear();
    waiters.forEach((notify) => notify());
  }

  private notifyOriginalAnswerWaiters(): void {
    const waiters = [...this.originalAnswerWaiters];
    this.originalAnswerWaiters.clear();
    waiters.forEach((notify) => notify());
  }
}

function localVoiceId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeNarrationText(text: string): string {
  return text.normalize("NFC").replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()《》【】…—\-]/gu, "");
}
