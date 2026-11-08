import { SpeechGate } from "./SpeechGate";
import { voiceTrace } from "./VoiceTrace";

export interface CaptureFrame {
  pcm: ArrayBuffer;
  rms: number;
  capturedAt: number;
}

export interface CaptureSettings {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  sampleRate: number | null;
  channelCount: number | null;
  supported: {
    echoCancellation: boolean | "unknown";
    noiseSuppression: boolean | "unknown";
    autoGainControl: boolean | "unknown";
  };
}

export interface CaptureCallbacks {
  /** Confirmed speech only. Candidate noise must not call this. */
  onSpeechStarted(): void;
  onSpeechEnded(): void;
  onSpeechCandidate?(): void;
  onSpeechMisfire?(reason: string): void;
  onFrame(frame: CaptureFrame): void;
  onDisconnected(): void;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function supportedFlag(constraints: MediaTrackSupportedConstraints | undefined, key: keyof MediaTrackSupportedConstraints): boolean | "unknown" {
  if (!constraints) return "unknown";
  return constraints[key] === true;
}

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private permissionStream: MediaStream | null = null;
  private readonly gate = new SpeechGate();
  private lifecycle = 0;
  private mode: "gate" | "manual" = "gate";
  private manualActive = false;
  private welcomeHoldOnly = false;
  private pendingWelcomeRearm = false;
  private settings: CaptureSettings | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private utteranceFrames = 0;
  private utteranceRmsSum = 0;

  constructor(private readonly callbacks: CaptureCallbacks) {}

  setMode(mode: "gate" | "manual"): void {
    if (mode !== this.mode) this.finishOpenInput("mode_switch");
    this.mode = mode;
    this.gate.reset();
    this.manualActive = false;
    this.clearStallWatch();
    this.resetUtteranceStats();
  }

  getMode(): "gate" | "manual" {
    return this.mode;
  }

  getSettings(): CaptureSettings | null {
    return this.settings;
  }

  getLifecycle(): number {
    return this.lifecycle;
  }

  isStopped(): boolean {
    return this.stream === null && this.worklet === null && this.permissionStream === null;
  }

  /** Welcome playback: keep the mic open, but auto-gate must not start a turn. */
  setWelcomeHoldOnly(enabled: boolean): void {
    if (enabled === this.welcomeHoldOnly) return;
    if (enabled) this.finishOpenInput("welcome_hold_only");
    this.welcomeHoldOnly = enabled;
    this.gate.reset();
    this.clearStallWatch();
    this.resetUtteranceStats();
  }

  isWelcomeHoldOnly(): boolean {
    return this.welcomeHoldOnly;
  }

  /** After welcome, restore auto-gate only once the echo tail is quiet. */
  rearmAfterWelcome(): void {
    this.welcomeHoldOnly = false;
    if (this.manualActive) {
      this.pendingWelcomeRearm = true;
      return;
    }
    this.applyWelcomeRearm();
  }

  setManualListening(active: boolean): void {
    if (this.mode !== "manual") return;
    if (active && !this.manualActive) {
      this.manualActive = true;
      this.resetUtteranceStats();
      voiceTrace.beginUtterance();
      voiceTrace.record("gate", { event: "confirmed", reason: "manual_press", mode: "manual" });
      this.callbacks.onSpeechStarted();
    } else if (!active && this.manualActive) {
      this.manualActive = false;
      voiceTrace.record("gate", {
        event: "ended",
        reason: "manual_release",
        mode: "manual",
        micFrames: this.utteranceFrames,
        rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
      });
      this.callbacks.onSpeechEnded();
      this.flushWelcomeRearm();
    }
  }

  /** Hold-to-interrupt during welcome, including when the user still prefers auto-gate. */
  setHoldListening(active: boolean): void {
    if (this.mode === "manual") {
      this.setManualListening(active);
      return;
    }
    if (!this.welcomeHoldOnly && !this.manualActive) return;
    if (active && !this.manualActive) {
      this.finishOpenInput("welcome_hold_only");
      this.manualActive = true;
      this.resetUtteranceStats();
      voiceTrace.beginUtterance();
      voiceTrace.record("gate", {
        event: "confirmed", reason: "user_manual_interrupt", mode: this.mode, policy: "welcome_hold_only",
      });
      this.callbacks.onSpeechStarted();
    } else if (!active && this.manualActive) {
      this.manualActive = false;
      voiceTrace.record("gate", {
        event: "ended",
        reason: "user_manual_interrupt",
        mode: this.mode,
        micFrames: this.utteranceFrames,
        rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
      });
      this.callbacks.onSpeechEnded();
      this.flushWelcomeRearm();
    }
  }

  /** Request permission directly from the visitor's click, but don't capture
   * audio until the voice bridge is ready. */
  async requestPermission(): Promise<void> {
    const lifecycle = this.lifecycle;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风采集");
    if (this.permissionStream) return;
    const context = this.context ?? new AudioContext();
    this.context = context;
    // Invoke getUserMedia before the first await so the browser sees the
    // permission request as a direct result of the visitor's button click.
    const permissionRequest = navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
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

  async start(): Promise<CaptureSettings> {
    const lifecycle = this.lifecycle;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风采集");
    const context = this.context ?? new AudioContext();
    this.context = context;
    try {
      await context.resume();
      const stream = this.permissionStream ?? await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
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
        if ((this.mode === "manual" || this.welcomeHoldOnly || this.manualActive) && this.manualActive) {
          this.noteUtteranceFrame(frame.rms);
        }
        if (this.mode === "gate" && !this.welcomeHoldOnly && !this.manualActive) {
          const pcm = frame.pcm.byteLength ? new Int16Array(frame.pcm) : undefined;
          const decision = this.gate.push({ rms: frame.rms, pcm, capturedAt: frame.capturedAt });
          if (this.gate.isConfirmed()) {
            this.noteUtteranceFrame(frame.rms);
            this.armStallWatch();
          }
          if (decision.event === "candidate") {
            voiceTrace.record("gate", {
              event: "candidate",
              rms: decision.stats.rms,
              noiseFloor: decision.stats.noiseFloor,
              voiceScore: decision.stats.voiceScore,
              reason: decision.stats.reason,
            });
            this.callbacks.onSpeechCandidate?.();
          } else if (decision.event === "confirmed") {
            this.resetUtteranceStats();
            this.noteUtteranceFrame(frame.rms);
            this.armStallWatch();
            voiceTrace.beginUtterance();
            voiceTrace.record("gate", {
              event: "confirmed",
              rms: decision.stats.rms,
              noiseFloor: decision.stats.noiseFloor,
              voiceScore: decision.stats.voiceScore,
              durationMs: decision.stats.durationMs,
              reason: decision.stats.reason,
            });
            this.callbacks.onSpeechStarted();
          } else if (decision.event === "ended") {
            this.clearStallWatch();
            voiceTrace.record("gate", {
              event: "ended",
              durationMs: decision.stats.durationMs,
              reason: decision.stats.reason,
              micFrames: this.utteranceFrames,
              rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
            });
            this.callbacks.onSpeechEnded();
          } else if (decision.event === "misfire") {
            this.clearStallWatch();
            voiceTrace.record("gate", {
              event: "misfire",
              durationMs: decision.stats.durationMs,
              reason: decision.stats.reason,
            });
            this.callbacks.onSpeechMisfire?.(decision.stats.reason);
          }
        }
        this.callbacks.onFrame(frame);
      };
      stream.getAudioTracks()[0].onended = () => {
        if (lifecycle !== this.lifecycle) return;
        this.stop();
        this.callbacks.onDisconnected();
      };
      const track = stream.getAudioTracks()[0];
      const actual = track.getSettings();
      const supported = navigator.mediaDevices.getSupportedConstraints?.();
      this.settings = {
        echoCancellation: boolOrNull(actual.echoCancellation),
        noiseSuppression: boolOrNull(actual.noiseSuppression),
        autoGainControl: boolOrNull(actual.autoGainControl),
        sampleRate: typeof actual.sampleRate === "number" ? actual.sampleRate : null,
        channelCount: typeof actual.channelCount === "number" ? actual.channelCount : null,
        supported: {
          echoCancellation: supportedFlag(supported, "echoCancellation"),
          noiseSuppression: supportedFlag(supported, "noiseSuppression"),
          autoGainControl: supportedFlag(supported, "autoGainControl"),
        },
      };
      voiceTrace.record("capture", {
        echoCancellation: this.settings.echoCancellation,
        noiseSuppression: this.settings.noiseSuppression,
        autoGainControl: this.settings.autoGainControl,
        sampleRate: this.settings.sampleRate,
        channelCount: this.settings.channelCount,
        nsSupported: String(this.settings.supported.noiseSuppression),
        agcSupported: String(this.settings.supported.autoGainControl),
      });
      return this.settings;
    } catch (error) {
      if (lifecycle === this.lifecycle) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.lifecycle += 1;
    this.clearStallWatch();
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
    this.manualActive = false;
    this.welcomeHoldOnly = false;
    this.pendingWelcomeRearm = false;
    this.gate.reset();
    this.resetUtteranceStats();
  }

  private applyWelcomeRearm(): void {
    this.pendingWelcomeRearm = false;
    this.clearStallWatch();
    this.resetUtteranceStats();
    this.gate.armQuietRearm();
  }

  private flushWelcomeRearm(): void {
    if (!this.pendingWelcomeRearm || this.manualActive) return;
    this.applyWelcomeRearm();
  }

  private finishOpenInput(reason: string): void {
    if (this.manualActive && (this.mode === "manual" || this.welcomeHoldOnly)) {
      this.manualActive = false;
      voiceTrace.record("gate", {
        event: "ended",
        reason,
        mode: this.mode,
        micFrames: this.utteranceFrames,
        rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
      });
      this.callbacks.onSpeechEnded();
      this.flushWelcomeRearm();
      return;
    }
    if (this.mode !== "gate") return;
    if (this.gate.isConfirmed()) {
      const duration = this.gate.snapshot().durationMs;
      this.clearStallWatch();
      this.gate.reset();
      voiceTrace.record("gate", {
        event: "ended",
        reason,
        durationMs: duration,
        micFrames: this.utteranceFrames,
        rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
      });
      this.callbacks.onSpeechEnded();
      return;
    }
    if (this.gate.isCandidate()) {
      this.gate.reset();
      this.callbacks.onSpeechMisfire?.(reason);
    }
  }

  private noteUtteranceFrame(rms: number): void {
    this.utteranceFrames += 1;
    this.utteranceRmsSum += rms;
  }

  private resetUtteranceStats(): void {
    this.utteranceFrames = 0;
    this.utteranceRmsSum = 0;
  }

  private armStallWatch(): void {
    this.clearStallWatch();
    const lifecycle = this.lifecycle;
    this.stallTimer = setTimeout(() => {
      if (lifecycle !== this.lifecycle || this.mode !== "gate") return;
      const ended = this.gate.forceEnd("capture_stalled");
      if (!ended) return;
      voiceTrace.record("gate", {
        event: "ended",
        reason: "capture_stalled",
        durationMs: ended.stats.durationMs,
        micFrames: this.utteranceFrames,
        rmsMean: this.utteranceFrames ? roundStat(this.utteranceRmsSum / this.utteranceFrames) : 0,
      });
      this.callbacks.onSpeechEnded();
    }, 400);
  }

  private clearStallWatch(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
}

function roundStat(value: number): number {
  return Math.round(value * 1000) / 1000;
}
