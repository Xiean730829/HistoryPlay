import { AudioFocus } from "./AudioFocus";
import type { AudioLease } from "./AudioFocus";

export interface NarrationSegment {
  packId: string;
  version: string;
  contentId: string;
  text: string;
  role?: "story" | "answer";
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
  private suspendedStory: NarrationSegment | null = null;
  private checkpoint: NarrationCheckpoint = { lastStarted: null, lastCompleted: null, state: "idle" };
  private readonly listeners = new Set<(checkpoint: NarrationCheckpoint, segment: NarrationSegment | null) => void>();

  constructor(private readonly adapter: NarrationAdapter, private readonly focus: AudioFocus) {}

  getCheckpoint(): NarrationCheckpoint { return { ...this.checkpoint }; }
  getSegment(): NarrationSegment | null { return this.segment ? { ...this.segment } : null; }

  subscribe(listener: (checkpoint: NarrationCheckpoint, segment: NarrationSegment | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    const checkpoint = this.getCheckpoint();
    const segment = this.getSegment();
    for (const listener of this.listeners) listener(checkpoint, segment);
  }

  async play(segment: NarrationSegment): Promise<boolean> {
    if (!segment.packId || !segment.version || !segment.contentId || !segment.text.trim()) {
      throw new Error("缺少固定讲解正文或稳定内容身份");
    }
    if (this.checkpoint.state === "interrupted" && this.segment?.role === "story" && segment.role === "answer") {
      this.suspendedStory = { ...this.segment };
    }
    this.stop();
    this.segment = { ...segment };
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    this.checkpoint.state = "preparing";
    this.publish();
    const lease = this.focus.claim("narration", () => this.stop());
    this.lease = lease;
    try {
      await this.adapter.play(segment, controller.signal, () => {
        if (sequence !== this.sequence || controller.signal.aborted) return;
        this.checkpoint.lastStarted = segment.contentId;
        this.checkpoint.state = "playing";
        this.publish();
      });
      if (sequence !== this.sequence || controller.signal.aborted) return false;
      this.checkpoint.lastCompleted = segment.contentId;
      this.checkpoint.state = "completed";
      this.publish();
      return true;
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return false;
      this.checkpoint.state = "error";
      this.publish();
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
      this.publish();
    }
  }

  resume(): Promise<boolean> {
    const target = this.suspendedStory ?? this.segment;
    if (!target || (!this.suspendedStory && this.checkpoint.state === "completed")) return Promise.resolve(false);
    this.suspendedStory = null;
    return this.play(target);
  }

  /** Leaving a story removes its resume target and rejects all late completion callbacks. */
  leave(): void {
    this.stop();
    this.segment = null;
    this.suspendedStory = null;
    this.checkpoint = { lastStarted: null, lastCompleted: null, state: "idle" };
    this.publish();
  }
}
