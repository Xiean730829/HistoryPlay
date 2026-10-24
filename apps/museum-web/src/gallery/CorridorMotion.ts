export interface CorridorMotionSnapshot {
  targetId: string | null;
  generation: number;
  animate: boolean;
}

/** Tracks authoritative destinations; rendered transition frames never change focus. */
export class CorridorMotion {
  private targetId: string | null = null;
  private generation = 0;
  private initialized = false;

  observe(targetId: string | null): CorridorMotionSnapshot {
    if (this.initialized && this.targetId === targetId) {
      return { targetId, generation: this.generation, animate: false };
    }
    const animate = this.initialized;
    this.initialized = true;
    this.targetId = targetId;
    this.generation += 1;
    return { targetId, generation: this.generation, animate };
  }
}
