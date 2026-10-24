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
  private readonly vad = new VadController();
  private lifecycle = 0;

  constructor(private readonly callbacks: CaptureCallbacks) {}

  async start(): Promise<{ echoCancellation: boolean | null }> {
    this.stop();
    const lifecycle = this.lifecycle;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风采集");
    const context = new AudioContext();
    this.context = context;
    try {
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (lifecycle !== this.lifecycle) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("麦克风开启已取消");
      }
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
    void this.context?.close().catch(() => undefined);
    this.worklet = null;
    this.source = null;
    this.mute = null;
    this.stream = null;
    this.context = null;
    this.vad.reset();
  }
}
