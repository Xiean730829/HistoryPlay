import type { SessionEvent } from "../api/eventChannel";
import type { ActiveSession } from "../application/museumApi";

export type ProjectionLoader = () => Promise<ActiveSession>;
export type ProjectionListener = (session: ActiveSession) => void;

/** Keeps a single authoritative session mirror and rejects duplicate or stale updates. */
export class SessionProjectionStore {
  private current: ActiveSession;
  private listeners = new Set<ProjectionListener>();
  private recovery: Promise<void> | null = null;
  private recoveryTarget: number;

  constructor(initial: ActiveSession, private readonly load: ProjectionLoader) {
    this.current = initial;
    this.recoveryTarget = initial.state.event_seq;
  }

  get snapshot(): ActiveSession {
    return this.current;
  }

  subscribe(listener: ProjectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async receiveEvent(event: SessionEvent): Promise<void> {
    if (event.session_id !== this.current.session_id || event.event_seq <= this.current.state.event_seq) return;
    const expected = this.current.state.event_seq + 1;
    if (event.event_seq !== expected) {
      await this.recover(event.event_seq);
      return;
    }
    // Events are hints that durable state changed; the query remains the projection authority.
    await this.recover(event.event_seq);
  }

  async receiveSnapshot(eventSeq: number): Promise<void> {
    if (!Number.isSafeInteger(eventSeq) || eventSeq < 0 || eventSeq < this.current.state.event_seq) return;
    await this.recover(eventSeq);
  }

  async acceptQuery(result: ActiveSession, minimumEventSeq = this.recoveryTarget): Promise<boolean> {
    if (result.session_id !== this.current.session_id) return false;
    if (result.state.event_seq < minimumEventSeq || result.state.event_seq < this.current.state.event_seq) return false;
    if (result.state.revision < this.current.state.revision) return false;
    this.publish(result);
    return true;
  }

  private recover(minimumEventSeq = this.current.state.event_seq): Promise<void> {
    this.recoveryTarget = Math.max(this.recoveryTarget, minimumEventSeq);
    if (this.recovery) return this.recovery;
    const task = (async () => {
      // A later event may arrive while a query is in flight; do one follow-up read.
      for (let attempt = 0; attempt < 2 && this.current.state.event_seq < this.recoveryTarget; attempt += 1) {
        const target = this.recoveryTarget;
        const result = await this.load();
        const before = this.current.state.event_seq;
        const accepted = await this.acceptQuery(result, target);
        if (!accepted && result.state.event_seq < target) continue;
        if (this.current.state.event_seq === before && this.current.state.event_seq < this.recoveryTarget) continue;
      }
    })()
      .finally(() => {
        if (this.recovery === task) this.recovery = null;
      });
    this.recovery = task;
    return task;
  }

  private publish(session: ActiveSession): void {
    this.current = session;
    for (const listener of this.listeners) listener(session);
  }
}
