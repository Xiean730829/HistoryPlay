import type { NarrationPlayer, NarrationSegment } from "../narration/NarrationPlayer";

export interface StoryPlaybackIdentity {
  sessionId: string;
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

/** Advances only after the fixed narration adapter reports actual playback completion. */
export class StoryAutoplayController {
  private active: ActiveNode | null = null;
  private currentIdentityKey = "";
  private unsubscribe: () => void;

  constructor(private readonly narration: NarrationPlayer, private readonly onAdvance: (key: string) => void) {
    this.unsubscribe = narration.subscribe((checkpoint, segment) => {
      const active = this.active;
      if (!active) return;
      if (checkpoint.state === "preparing" && segment?.role === "story" && segment.contentId === active.nodeId) {
        active.key = this.currentIdentityKey;
        active.authorized = true;
        active.advanced = false;
        return;
      }
      if (!active.authorized || active.advanced || !active.canContinue
        || checkpoint.state !== "completed" || checkpoint.lastCompleted !== active.nodeId) return;
      active.advanced = true;
      this.onAdvance(active.key);
    });
  }

  /** A revision/epoch change revokes the current playback's right to advance. */
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
