import { AudioFocus } from "./AudioFocus";
import type { AudioLease } from "./AudioFocus";

export interface NarrationSegment {
  packId: string;
  version: string;
  contentId: string;
  text: string;
}

export interface NarrationAdapter {
  /** Resolve after playback completes, not when a synthesis request was accepted. */
  play(segment: NarrationSegment, signal: AbortSignal, onStarted: () => void): Promise<void>;
}

export interface NarrationCheckpoint {
  lastStarted: string | null;
  lastCompleted: string | null;
  state: "idle" | "preparing" | "playing" | "interrupted" | "completed" | "error";
}

/** Presentation does not advance the story. "Continue" replays the interrupted segment. */
export class NarrationPlayer {
  private segment: NarrationSegment | null = null;
  private controller: AbortController | null = null;
  private lease: AudioLease | null = null;
  private sequence = 0;
  private checkpoint: NarrationCheckpoint = { lastStarted: null, lastCompleted: null, state: "idle" };

  constructor(private readonly adapter: NarrationAdapter, private readonly focus: AudioFocus) {}

  getCheckpoint(): NarrationCheckpoint { return { ...this.checkpoint }; }

  async play(segment: NarrationSegment): Promise<boolean> {
    if (!segment.packId || !segment.version || !segment.contentId || !segment.text.trim()) {
      throw new Error("缺少固定讲解正文或稳定内容身份");
    }
    this.stop();
    this.segment = { ...segment };
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    this.checkpoint.state = "preparing";
    const lease = this.focus.claim("narration", () => this.stop());
    this.lease = lease;
    try {
      await this.adapter.play(segment, controller.signal, () => {
        if (sequence !== this.sequence || controller.signal.aborted) return;
        this.checkpoint.lastStarted = segment.contentId;
        this.checkpoint.state = "playing";
      });
      if (sequence !== this.sequence || controller.signal.aborted) return false;
      this.checkpoint.lastCompleted = segment.contentId;
      this.checkpoint.state = "completed";
      return true;
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return false;
      this.checkpoint.state = "error";
      throw error;
    } finally {
      lease.release();
      if (sequence === this.sequence) { this.controller = null; this.lease = null; }
    }
  }

  stop(): void {
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
    this.lease?.release();
    this.lease = null;
    if (this.checkpoint.state === "playing" || this.checkpoint.state === "preparing") {
      this.checkpoint.state = "interrupted";
    }
  }

  resume(): Promise<boolean> {
    if (!this.segment || this.checkpoint.state === "completed") return Promise.resolve(false);
    return this.play(this.segment);
  }

  /** Leaving a story removes its resume target and rejects all late completion callbacks. */
  leave(): void {
    this.stop();
    this.segment = null;
    this.checkpoint = { lastStarted: null, lastCompleted: null, state: "idle" };
  }
}
