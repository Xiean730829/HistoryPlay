import { VadController } from "./VadController";

export interface CaptureFrame {
  pcm: ArrayBuffer;
  rms: number;
  capturedAt: number;
}

export interface CaptureCallbacks {
  /** Stop all local playback here first; this callback precedes onFrame. */
  onSpeechStarted(): void;
  onSpeechEnded(): void;
  onFrame(frame: CaptureFrame): void;
  onDisconnected(): void;
}

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private permissionStream: MediaStream | null = null;
  private readonly vad = new VadController();
  private lifecycle = 0;

  constructor(private readonly callbacks: CaptureCallbacks) {}

  /** Request permission directly from the visitor's click, but don't capture
   * audio until the voice bridge and welcome message are ready. */
  async requestPermission(): Promise<void> {
    const lifecycle = this.lifecycle;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风采集");
    if (this.permissionStream) return;
    const context = this.context ?? new AudioContext();
    this.context = context;
    // Invoke getUserMedia before the first await so the browser sees the
    // permission request as a direct result of the visitor's button click.
    const permissionRequest = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    try {
      await context.resume();
      const stream = await permissionRequest;
      if (lifecycle !== this.lifecycle) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("麦克风开启已取消");
      }
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      this.permissionStream = stream;
    } catch (error) {
      // If resume failed before the permission prompt settled, stop any stream
      // that the browser may still return later.
      void permissionRequest.then((stream) => {
        if (this.permissionStream !== stream && this.stream !== stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      }).catch(() => undefined);
      if (lifecycle === this.lifecycle) await this.context?.close().catch(() => undefined);
      if (lifecycle === this.lifecycle) this.context = null;
      throw error;
    }
  }

  async start(): Promise<{ echoCancellation: boolean | null }> {
    const lifecycle = this.lifecycle;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风采集");
    const context = this.context ?? new AudioContext();
    this.context = context;
    try {
      await context.resume();
      const stream = this.permissionStream ?? await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (lifecycle !== this.lifecycle) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("麦克风开启已取消");
      }
      this.permissionStream = null;
      stream.getAudioTracks().forEach((track) => { track.enabled = true; });
      this.stream = stream;
      await context.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
      if (lifecycle !== this.lifecycle) throw new Error("麦克风开启已取消");
      this.source = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, "museum-capture");
      this.mute = context.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.worklet).connect(this.mute).connect(context.destination);
      this.worklet.port.onmessage = (event: MessageEvent<CaptureFrame>) => {
        if (lifecycle !== this.lifecycle) return;
        const frame = event.data;
        const vadEvent = this.vad.push(frame.rms);
        if (vadEvent === "speech_started") this.callbacks.onSpeechStarted();
        if (vadEvent === "speech_ended") this.callbacks.onSpeechEnded();
        this.callbacks.onFrame(frame);
      };
      stream.getAudioTracks()[0].onended = () => {
        if (lifecycle !== this.lifecycle) return;
        this.stop();
        this.callbacks.onDisconnected();
      };
      const echoCancellation = stream.getAudioTracks()[0].getSettings().echoCancellation;
      return { echoCancellation: typeof echoCancellation === "boolean" ? echoCancellation : null };
    } catch (error) {
      if (lifecycle === this.lifecycle) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.lifecycle += 1;
    if (this.worklet) this.worklet.port.onmessage = null;
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.mute?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    for (const track of this.permissionStream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    void this.context?.close().catch(() => undefined);
    this.worklet = null;
    this.source = null;
    this.mute = null;
    this.stream = null;
    this.permissionStream = null;
    this.context = null;
    this.vad.reset();
  }
}
