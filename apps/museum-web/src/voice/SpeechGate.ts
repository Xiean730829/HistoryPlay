export type GateEventName = "candidate" | "confirmed" | "ended" | "misfire";

export interface GateFrame {
  rms: number;
  pcm?: ArrayLike<number>;
  capturedAt?: number;
  frameMs?: number;
}

export interface GateStats {
  rms: number;
  noiseFloor: number;
  snrDb: number;
  voiceScore: number;
  modulation: number;
  durationMs: number;
  reason: string;
}

export interface GateDecision {
  event: GateEventName | null;
  stats: GateStats;
}

const FRAME_MS = 20;
const START_MS = 160;
const CANDIDATE_MS = 60;
const END_MS = 1100;
const MIN_SPEECH_MS = 180;
const MAX_SPEECH_MS = 30_000;
const RMS_WINDOW = 16;
const INITIAL_FLOOR = 0.0004;
const FLOOR_RISE = 0.004;
const FLOOR_FALL = 0.08;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function db(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-10));
}

function zeroCrossingRate(pcm: ArrayLike<number>): number {
  if (pcm.length < 2) return 0;
  let crossings = 0;
  for (let index = 1; index < pcm.length; index += 1) {
    const previous = pcm[index - 1];
    const current = pcm[index];
    if ((previous >= 0) !== (current >= 0) && (previous !== 0 || current !== 0)) crossings += 1;
  }
  return crossings / pcm.length;
}

/**
 * Heuristic voice-likeness + noise-floor gate. Energy is only an auxiliary signal.
 * voiceScore is not a speech-recognition model probability.
 * A steady fan above a fixed RMS threshold must not confirm speech or hang open.
 */
const REARM_MS = 120;
const COOLDOWN_MS = 200;

export class SpeechGate {
  private phase: "idle" | "candidate" | "confirmed" = "idle";
  private voiceMs = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private speechPeakRms = 0;
  private noiseFloor = INITIAL_FLOOR;
  private warmupMs = 0;
  private holdOff = false;
  private rearmMs = 0;
  private cooldownMs = 0;
  private readonly rmsWindow: number[] = [];
  private lastStats: GateStats = {
    rms: 0, noiseFloor: INITIAL_FLOOR, snrDb: 0, voiceScore: 0, modulation: 0, durationMs: 0, reason: "idle",
  };

  push(frame: GateFrame): GateDecision {
    const frameMs = Number.isFinite(frame.frameMs) && (frame.frameMs ?? 0) > 0 ? frame.frameMs as number : FRAME_MS;
    const rms = frame.rms;
    if (!Number.isFinite(rms) || rms < 0 || !Number.isFinite(frameMs)) {
      return { event: null, stats: this.lastStats };
    }
    this.warmupMs += frameMs;
    this.rmsWindow.push(rms);
    if (this.rmsWindow.length > RMS_WINDOW) this.rmsWindow.shift();
    const modulation = this.modulation();
    const snrDb = db(rms) - db(this.noiseFloor);
    const zcr = frame.pcm ? zeroCrossingRate(frame.pcm) : 0;
    const speechLikeZcr = zcr >= 0.02 && zcr <= 0.35 ? 1 : zcr > 0 && zcr < 0.5 ? 0.4 : 0.1;
    const snrScore = clamp((snrDb - 3) / 12, 0, 1);
    const modulationScore = clamp((modulation - 0.04) / 0.22, 0, 1);
    const voiceScore = clamp(0.45 * snrScore + 0.4 * modulationScore + 0.15 * speechLikeZcr, 0, 1);
    const voiced = voiceScore >= 0.42 && snrDb >= 6 && modulation >= 0.08;
    const likelyVoice = voiceScore >= 0.32 && snrDb >= 4 && modulation >= 0.05;
    const hangingNoise = !voiced && (modulation < 0.06 || snrDb < 5);
    this.updateFloor(rms, snrDb, modulation, likelyVoice);
    const stats: GateStats = {
      rms: round(rms),
      noiseFloor: round(this.noiseFloor),
      snrDb: round(snrDb),
      voiceScore: round(voiceScore),
      modulation: round(modulation),
      durationMs: this.phase === "confirmed" ? this.speechMs : this.voiceMs,
      reason: this.phase,
    };
    this.lastStats = stats;

    if (this.holdOff) {
      const quiet = !voiced && (!likelyVoice || hangingNoise);
      if (quiet) {
        this.rearmMs += frameMs;
        if (this.rearmMs >= REARM_MS) {
          this.holdOff = false;
          this.rearmMs = 0;
          this.cooldownMs = COOLDOWN_MS;
          stats.reason = "rearmed";
        } else {
          stats.reason = "hold_off";
        }
      } else {
        this.rearmMs = 0;
        stats.reason = "hold_off";
      }
      this.voiceMs = 0;
      this.lastStats = stats;
      return { event: null, stats };
    }

    if (this.cooldownMs > 0) {
      this.cooldownMs = Math.max(0, this.cooldownMs - frameMs);
      this.voiceMs = 0;
      stats.reason = this.cooldownMs > 0 ? "cooldown" : "rearmed";
      this.lastStats = stats;
      return { event: null, stats };
    }

    if (this.phase === "confirmed") {
      this.speechPeakRms = Math.max(rms, this.speechPeakRms * 0.995);
      // Start remains conservative, but once a person is speaking do not cut
      // stable syllables just because amplitude modulation briefly disappears.
      const sustainedVoice = snrDb >= 8 && rms >= Math.max(this.noiseFloor * 2.5, this.speechPeakRms * 0.22);
      this.speechMs += frameMs;
      if (this.speechMs >= MAX_SPEECH_MS) {
        const duration = this.speechMs;
        this.enterHoldOff();
        stats.reason = "max_duration";
        stats.durationMs = duration;
        return { event: "ended", stats };
      }
      if ((!likelyVoice || hangingNoise) && !sustainedVoice) {
        this.silenceMs += frameMs;
        if (this.silenceMs >= END_MS) {
          const duration = this.speechMs;
          this.resetActive();
          this.cooldownMs = COOLDOWN_MS;
          if (duration < MIN_SPEECH_MS) {
            stats.reason = "too_short";
            stats.durationMs = duration;
            return { event: "misfire", stats };
          }
          stats.reason = "voice_ended";
          stats.durationMs = duration;
          return { event: "ended", stats };
        }
      } else {
        this.silenceMs = 0;
      }
      return { event: null, stats };
    }

    if (voiced) {
      this.silenceMs = 0;
      this.voiceMs += frameMs;
      if (this.phase === "idle" && this.voiceMs >= CANDIDATE_MS) {
        this.phase = "candidate";
        stats.reason = "candidate_energy_and_modulation";
        stats.durationMs = this.voiceMs;
        return { event: "candidate", stats };
      }
      if (this.phase === "candidate" && this.voiceMs >= START_MS) {
        this.phase = "confirmed";
        this.speechMs = this.voiceMs;
        this.speechPeakRms = Math.max(...this.rmsWindow);
        stats.reason = "confirmed_speech";
        stats.durationMs = this.speechMs;
        return { event: "confirmed", stats };
      }
      return { event: null, stats };
    }

    if (this.phase === "candidate") {
      this.silenceMs += frameMs;
      if (this.silenceMs >= 120 || !likelyVoice) {
        const duration = this.voiceMs;
        this.resetActive();
        this.cooldownMs = COOLDOWN_MS;
        stats.reason = "unconfirmed_burst";
        stats.durationMs = duration;
        return { event: "misfire", stats };
      }
      return { event: null, stats };
    }

    this.voiceMs = 0;
    return { event: null, stats };
  }

  snapshot(): GateStats {
    return { ...this.lastStats };
  }

  isConfirmed(): boolean {
    return this.phase === "confirmed";
  }

  isCandidate(): boolean {
    return this.phase === "candidate";
  }

  reset(): void {
    this.resetActive();
    this.holdOff = false;
    this.rearmMs = 0;
    this.cooldownMs = 0;
    this.noiseFloor = INITIAL_FLOOR;
    this.warmupMs = 0;
    this.rmsWindow.length = 0;
    this.lastStats = {
      rms: 0, noiseFloor: INITIAL_FLOOR, snrDb: 0, voiceScore: 0, modulation: 0, durationMs: 0, reason: "reset",
    };
  }

  /** Close an open confirmation without waiting for the next audio frame. */
  forceEnd(reason = "capture_stalled"): GateDecision | null {
    if (this.phase !== "confirmed") return null;
    const duration = this.speechMs;
    this.resetActive();
    this.cooldownMs = COOLDOWN_MS;
    const stats: GateStats = { ...this.lastStats, reason, durationMs: duration };
    this.lastStats = stats;
    return { event: "ended", stats };
  }

  /** Wait for a quiet echo tail before auto-confirm can fire again. */
  armQuietRearm(): void {
    this.enterHoldOff();
    this.lastStats = { ...this.lastStats, reason: "hold_off", durationMs: 0 };
  }

  private enterHoldOff(): void {
    this.holdOff = true;
    this.rearmMs = 0;
    this.resetActive();
  }

  private resetActive(): void {
    this.phase = "idle";
    this.voiceMs = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.speechPeakRms = 0;
  }

  private modulation(): number {
    if (this.rmsWindow.length < 4) return 0;
    const mean = this.rmsWindow.reduce((sum, item) => sum + item, 0) / this.rmsWindow.length;
    if (mean < 1e-8) return 0;
    const variance = this.rmsWindow.reduce((sum, item) => sum + (item - mean) ** 2, 0) / this.rmsWindow.length;
    return Math.sqrt(variance) / mean;
  }

  private updateFloor(rms: number, snrDb: number, modulation: number, likelyVoice: boolean): void {
    if (this.holdOff) {
      const target = Math.max(1e-6, rms);
      const delta = target - this.noiseFloor;
      const rate = delta > 0 ? FLOOR_RISE : FLOOR_FALL;
      this.noiseFloor = clamp(this.noiseFloor + delta * rate, 1e-6, 0.2);
      return;
    }
    const speakingImmediately = this.warmupMs < 280 && rms > this.noiseFloor * 4;
    if (speakingImmediately || likelyVoice || this.phase === "confirmed") return;
    if (snrDb > 8 && modulation > 0.12) return;
    const target = Math.max(1e-6, rms);
    const delta = target - this.noiseFloor;
    const rate = delta > 0 ? FLOOR_RISE : FLOOR_FALL;
    this.noiseFloor = clamp(this.noiseFloor + delta * rate, 1e-6, 0.2);
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
