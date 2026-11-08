import type { CommandReceipt } from "@history-play/contracts";
import type { ActiveSession, RenderReceiptPayload } from "../application/museumApi";

type RenderStatus = RenderReceiptPayload["status"];
type SendReceipt = (session: ActiveSession, payload: RenderReceiptPayload) => Promise<void>;

/** Associates visible-frame evidence with one still-current committed command. */
export class RenderReceiptReporter {
  private readonly sent = new Set<string>();
  private readonly sending = new Map<string, Promise<void>>();

  constructor(private readonly send: SendReceipt) {}

  async report(
    session: ActiveSession,
    command: CommandReceipt | null,
    status: RenderStatus,
    reason?: string,
  ): Promise<boolean> {
    if (
      !command || command.status !== "committed" || command.session_id !== session.session_id ||
      !command.payload_digest || !Number.isInteger(command.view_revision) ||
      command.revision !== session.state.revision ||
      command.view_revision !== session.state.view_revision ||
      command.interaction_epoch !== session.state.interaction_epoch
    ) return false;

    const safeReason = reason?.trim();
    if (status === "degraded" && !safeReason) return false;
    const payload: RenderReceiptPayload = {
      request_id: command.request_id,
      payload_digest: command.payload_digest,
      revision: command.revision,
      view_revision: command.view_revision,
      interaction_epoch: command.interaction_epoch,
      status,
      ...(status === "degraded" ? { reason: Array.from(safeReason!).slice(0, 200).join("") } : {}),
    };
    const key = [session.session_id, session.connection_id, command.request_id, status].join(":");
    // A later voice waiter can subscribe after SSE has already rendered and
    // reported this exact command. Reuse that evidence instead of timing out.
    if (this.sent.has(key)) return true;
    let pending = this.sending.get(key);
    if (!pending) {
      pending = this.send(session, payload);
      this.sending.set(key, pending);
    }
    try { await pending; }
    finally { if (this.sending.get(key) === pending) this.sending.delete(key); }
    this.sent.add(key);
    if (this.sent.size > 256) this.sent.delete(this.sent.values().next().value!);
    return true;
  }
}
