import type { NarrationPlayer, NarrationSegment } from "../narration/NarrationPlayer";

export interface StoryPlaybackIdentity {
  sessionId: string;
  artifactId: string;
  storyId: string;
  nodeId: string;
  revision: number;
  interactionEpoch: number;
}

interface ActiveNode {
  key: string;
  nodeId: string;
  canContinue: boolean;
  advanced: boolean;
  authorized: boolean;
  segment: NarrationSegment;
}

/** Advances only after the live narrator reports actual audio start and then completion. */
export class StoryAutoplayController {
  private active: ActiveNode | null = null;
  private currentIdentityKey = "";
  private unsubscribe: () => void;

  constructor(private readonly narration: NarrationPlayer, private readonly onAdvance: (key: string) => void) {
    this.unsubscribe = narration.subscribe((checkpoint, segment) => {
      const active = this.active;
      if (!active) return;
      if (checkpoint.state === "playing" && segment?.role === "story" && segment.contentId === active.nodeId) {
        if (!active.advanced) {
          active.key = this.currentIdentityKey;
          active.authorized = true;
        }
        return;
      }
      if (checkpoint.state === "interrupted" || checkpoint.state === "error") {
        active.authorized = false;
        return;
      }
      if (!active.authorized || active.advanced || !active.canContinue
        || checkpoint.state !== "completed" || checkpoint.lastCompleted !== active.nodeId
        || active.key !== this.currentIdentityKey) return;
      active.advanced = true;
      this.onAdvance(active.key);
    });
  }

  /** A revision/epoch/exhibit change revokes the current playback's right to advance. */
  updateIdentity(identity: StoryPlaybackIdentity): void {
    const key = JSON.stringify(identity);
    if (key === this.currentIdentityKey) return;
    this.currentIdentityKey = key;
    if (this.active) this.active.authorized = false;
  }

  isPlaybackAuthorized(identity: StoryPlaybackIdentity): boolean {
    return this.active?.authorized === true && this.active.key === JSON.stringify(identity);
  }

  start(identity: StoryPlaybackIdentity, segment: NarrationSegment, canContinue: boolean): Promise<boolean> {
    if (!identity.sessionId || !identity.artifactId || !identity.storyId || !identity.nodeId) {
      return Promise.resolve(false);
    }
    const key = JSON.stringify(identity);
    if (this.active?.key === key) return Promise.resolve(false);
    this.updateIdentity(identity);
    this.narration.leave();
    const storySegment = { ...segment, role: "story" as const };
    this.active = { key, nodeId: identity.nodeId, canContinue, advanced: false, authorized: false, segment: storySegment };
    return this.narration.play(storySegment);
  }

  retry(): Promise<boolean> {
    return this.active ? this.narration.play(this.active.segment) : Promise.resolve(false);
  }

  manualAdvance(): void {
    this.active = null;
    this.narration.leave();
  }

  leave(): void {
    this.active = null;
    this.narration.leave();
  }

  dispose(): void {
    this.leave();
    this.unsubscribe();
  }
}
