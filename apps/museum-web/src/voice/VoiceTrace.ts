export type TraceStage =
  | "capture"
  | "gate"
  | "uplink"
  | "stt"
  | "intent"
  | "action"
  | "render"
  | "guide"
  | "connection"
  | "answer"
  | "fixed";

export interface VoiceTraceSnapshot {
  utteranceId: string;
  startedAt: number;
  currentStage: TraceStage | "idle";
  connected: boolean;
  stages: Partial<Record<TraceStage, Record<string, string | number | boolean | null>>>;
}

const MAX_TRACES = 8;

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

function sanitize(value: Record<string, string | number | boolean | null | undefined>) {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (typeof item === "string") {
      const clipped = item.length > 160 ? `${item.slice(0, 160)}…` : item;
      if (/token|key|secret|authorization|cookie|pcm|audio/i.test(key)) continue;
      clean[key] = clipped;
    } else {
      clean[key] = item;
    }
  }
  return clean;
}

/** One local utterance timeline. No audio bytes, tokens, or device files. */
export class VoiceTraceLog {
  private readonly traces: VoiceTraceSnapshot[] = [];
  private current: VoiceTraceSnapshot | null = null;
  private connected = false;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): VoiceTraceSnapshot | null {
    return this.current ? structuredClone(this.current) : null;
  }

  history(): VoiceTraceSnapshot[] {
    return this.traces.map((item) => structuredClone(item));
  }

  setConnected(connected: boolean, detail?: string): void {
    this.connected = connected;
    if (!this.current) {
      this.current = {
        utteranceId: "none",
        startedAt: Date.now(),
        currentStage: "connection",
        connected,
        stages: {
          connection: sanitize({ connected, detail: detail ?? (connected ? "connected" : "disconnected") }),
        },
      };
    } else {
      this.current.connected = connected;
      this.current.stages.connection = sanitize({
        connected,
        detail: detail ?? (connected ? "connected" : "disconnected"),
      });
    }
    this.publish();
  }

  beginUtterance(): string {
    const previous = this.current;
    const utteranceId = randomId();
    if (previous && previous.utteranceId !== "none") {
      const alreadyStopped = previous.stages.uplink?.stop === true;
      const reason = alreadyStopped ? "answer_superseded" : "superseded";
      previous.stages.uplink = sanitize({
        ...(previous.stages.uplink ?? {}),
        successorId: utteranceId,
        cancel: true,
        reason,
      });
      if (alreadyStopped) {
        previous.stages.answer = sanitize({
          ...(previous.stages.answer ?? {}),
          cancelled: true,
          reason,
          successorId: utteranceId,
        });
        if (previous.stages.action || previous.stages.render) {
          previous.stages.render = sanitize({
            ...(previous.stages.render ?? {}),
            cancelled: true,
            reason: "render_superseded",
            successorId: utteranceId,
          });
        }
      }
    }
    this.current = {
      utteranceId,
      startedAt: Date.now(),
      currentStage: "gate",
      connected: this.connected,
      stages: {},
    };
    this.traces.push(this.current);
    if (this.traces.length > MAX_TRACES) this.traces.shift();
    this.publish();
    return utteranceId;
  }

  record(stage: TraceStage, fields: Record<string, string | number | boolean | null | undefined>): void {
    if (!this.current || this.current.utteranceId === "none") {
      this.current = {
        utteranceId: "none",
        startedAt: Date.now(),
        currentStage: stage,
        connected: this.connected,
        stages: {},
      };
    }
    this.current.currentStage = stage;
    this.current.connected = this.connected;
    this.current.stages[stage] = {
      ...(this.current.stages[stage] ?? {}),
      ...sanitize(fields),
      t: Date.now() - this.current.startedAt,
    };
    this.publish();
  }

  summaryLine(): string {
    if (!this.connected && (!this.current || this.current.utteranceId === "none")) {
      return "未连接";
    }
    const current = this.current;
    if (!current) return this.connected ? "已连接，等待说话" : "未连接";
    const stage = current.currentStage;
    const id = current.utteranceId === "none" ? "—" : current.utteranceId.slice(0, 8);
    return `${this.connected ? "已连接" : "未连接"} · ${stage} · ${id}`;
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export const voiceTrace = new VoiceTraceLog();
