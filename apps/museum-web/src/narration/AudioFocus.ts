export interface AudioLease { release(): void; }

/** Fixed narration and free QA have one exclusive audio owner. */
export class AudioFocus {
  private current: { owner: string; stop: () => void; id: number } | null = null;
  private sequence = 0;

  claim(owner: string, stop: () => void): AudioLease {
    const previous = this.current;
    const id = ++this.sequence;
    this.current = { owner, stop, id };
    previous?.stop();
    return { release: () => { if (this.current?.id === id) this.current = null; } };
  }

  get owner(): string | null { return this.current?.owner ?? null; }

  stop(): void {
    const previous = this.current;
    this.current = null;
    previous?.stop();
  }
}
