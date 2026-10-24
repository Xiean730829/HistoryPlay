import { PlaybackQueue } from "./PlaybackQueue";

export interface VoiceCallbacks {
  onState(state: "connecting" | "connected" | "disconnected" | "error", message?: string): void;
  onText(type: "stt" | "tts" | "llm", text: string, state?: string): void;
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

  constructor(
    private readonly playback: PlaybackQueue,
    private readonly callbacks: VoiceCallbacks,
    private readonly endpoint = "ws://127.0.0.1:8781/voice/ws",
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
    this.callbacks.onState("connecting");
    const socket = new WebSocket(this.endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (!settled) { settled = true; reject(new Error("本机语音连接未完成")); }
      };
      const timer = setTimeout(() => { fail(); this.disconnect(); }, 30000);
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (connection !== this.connection) return;
        if (typeof event.data === "string") {
          let data: { type?: string; state?: string; text?: string };
          try { data = JSON.parse(event.data); } catch { return; }
          if (data.type === "ready") {
            this.ready = true;
            clearTimeout(timer);
            settled = true;
            this.callbacks.onState("connected");
            resolve();
          } else if (data.type === "bridge_error") {
            fail(); this.callbacks.onState("error", "语音连接中止，请检查固定设备配置");
          } else if (data.type === "stt" || data.type === "tts" || data.type === "llm") {
            this.callbacks.onText(data.type, data.text ?? "", data.state);
          }
        } else if (event.data.byteLength >= 6 && (event.data.byteLength - 4) % 2 === 0) {
          const sampleRate = new DataView(event.data).getUint32(0, false);
          const pcm = new Int16Array(event.data.slice(4));
          this.playback.enqueue(pcm, sampleRate, epoch);
        }
      };
      socket.onclose = () => {
        clearTimeout(timer); fail();
        if (connection !== this.connection) return;
        this.ready = false;
        this.listening = false;
        this.pending = [];
        this.turnRequested = false;
        this.turnEnded = false;
        this.playback.stop();
        this.callbacks.onState("disconnected");
      };
      socket.onerror = () => { clearTimeout(timer); fail(); };
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
}
