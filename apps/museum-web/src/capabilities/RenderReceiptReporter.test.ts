import { describe, expect, it, vi } from "vitest";
import type { CommandReceipt } from "@history-play/contracts";
import type { ActiveSession } from "../application/museumApi";
import { RenderReceiptReporter } from "./RenderReceiptReporter";

const session = {
  session_id: "session-1",
  connection_id: "connection-1",
  state: { revision: 7, view_revision: 3, interaction_epoch: 2 },
} as ActiveSession;
const command = {
  session_id: "session-1",
  request_id: "request-1",
  payload_digest: "sha256:abc",
  status: "committed",
  revision: 7,
  view_revision: 3,
  interaction_epoch: 2,
} as CommandReceipt;

describe("RenderReceiptReporter", () => {
  it("only reports a matching committed command after a visible render", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = new RenderReceiptReporter(send);

    expect(await reporter.report(session, command, "rendered")).toBe(true);
    expect(send).toHaveBeenCalledWith(session, {
      request_id: "request-1",
      payload_digest: "sha256:abc",
      revision: 7,
      view_revision: 3,
      interaction_epoch: 2,
      status: "rendered",
    });
    expect(await reporter.report(session, command, "rendered")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ignores rejected, stale, incomplete and command-less receipts", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = new RenderReceiptReporter(send);
    expect(await reporter.report(session, null, "rendered")).toBe(false);
    expect(await reporter.report(session, { ...command, status: "rejected" }, "rendered")).toBe(false);
    expect(await reporter.report(session, { ...command, revision: 6 }, "rendered")).toBe(false);
    expect(await reporter.report(session, { ...command, view_revision: undefined }, "rendered")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("requires a truthful fallback reason and bounds its length", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = new RenderReceiptReporter(send);
    expect(await reporter.report(session, command, "degraded")).toBe(false);
    expect(await reporter.report(session, command, "degraded", ` ${"预览".repeat(150)} `)).toBe(true);
    expect(send.mock.calls[0][1].reason).toHaveLength(200);
  });
});
