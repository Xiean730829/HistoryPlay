export type VadEvent = "speech_started" | "speech_ended" | null;

/** Energy VAD runs while the speaker is playing too. It is not a cloud turn ID. */
export class VadController {
  private active = false;
  private voiceMs = 0;
  private silenceMs = 0;

  constructor(
    private readonly thresholdDb = -43,
    private readonly startMs = 120,
    private readonly endMs = 650,
  ) {}

  push(rms: number, frameMs = 20): VadEvent {
    if (!Number.isFinite(rms) || rms < 0 || !Number.isFinite(frameMs) || frameMs <= 0) {
      return null;
    }
    const voiced = 20 * Math.log10(Math.max(rms, 1e-10)) >= this.thresholdDb;
    if (voiced) {
      this.silenceMs = 0;
      this.voiceMs += frameMs;
      if (!this.active && this.voiceMs >= this.startMs) {
        this.active = true;
        return "speech_started";
      }
    } else {
      this.voiceMs = 0;
      if (this.active) {
        this.silenceMs += frameMs;
        if (this.silenceMs >= this.endMs) {
          this.active = false;
          this.silenceMs = 0;
          return "speech_ended";
        }
      }
    }
    return null;
  }

  reset(): void {
    this.active = false;
    this.voiceMs = 0;
    this.silenceMs = 0;
  }
}
