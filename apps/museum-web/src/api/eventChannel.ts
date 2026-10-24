import type { ActiveSession } from "../application/museumApi";

export interface SessionEvent {
  session_id: string;
  event_seq: number;
  kind: string;
  revision: number;
  interaction_epoch: number;
  entity_id?: string | null;
  story_id?: string | null;
  node_id?: string | null;
}

export type EventFrame =
  | { type: "event"; event: SessionEvent }
  | { type: "snapshot"; event_seq: number; state: unknown };

export type EventTicketProvider = (session: ActiveSession) => Promise<{ ticket: string }>;
export type EventSocketFactory = (url: string, protocols: string[]) => WebSocket;

export interface EventChannelOptions {
  session: ActiveSession;
  getCursor: () => number;
  requestTicket: EventTicketProvider;
  onEvent: (event: SessionEvent) => void;
  onSnapshot: (eventSeq: number) => void;
  socketFactory?: EventSocketFactory;
  reconnectDelayMs?: number;
}

/** Reconnects with a fresh, short-lived ticket; credentials are never placed in a URL. */
export class EventChannel {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private connecting = false;
  private readonly factory: EventSocketFactory;

  constructor(private readonly options: EventChannelOptions) {
    this.factory = options.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols));
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close(1000, "session changed");
    this.socket = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    try {
      const { ticket } = await this.options.requestTicket(this.options.session);
      if (this.stopped) return;
      const url = new URL(`/api/sessions/${encodeURIComponent(this.options.session.session_id)}/events`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("after_seq", String(this.options.getCursor()));
      const socket = this.factory(url.toString(), ["museum-events.v1", `museum-ticket.${ticket}`]);
      this.socket = socket;
      socket.onmessage = (message) => this.handleMessage(message.data);
      socket.onclose = () => this.scheduleReconnect();
      socket.onerror = () => socket.close();
    } catch {
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let frame: EventFrame;
    try {
      frame = JSON.parse(raw) as EventFrame;
    } catch {
      return;
    }
    if (frame.type === "event" && isSessionEvent(frame.event)) this.options.onEvent(frame.event);
    if (frame.type === "snapshot" && Number.isSafeInteger(frame.event_seq)) this.options.onSnapshot(frame.event_seq);
  }

  private scheduleReconnect(): void {
    this.socket = null;
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, this.options.reconnectDelayMs ?? 500);
  }
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SessionEvent>;
  return typeof event.session_id === "string" && Number.isSafeInteger(event.event_seq)
    && typeof event.kind === "string" && Number.isSafeInteger(event.revision)
    && Number.isSafeInteger(event.interaction_epoch);
}
