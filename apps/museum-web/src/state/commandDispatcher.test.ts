import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "./commandDispatcher";

describe("CommandDispatcher", () => {
  it("deduplicates concurrent submissions and sends a stable request id", async () => {
    const dispatcher = new CommandDispatcher();
    let finish!: (value: string) => void;
    const sender = vi.fn((requestId: string) => new Promise<string>((resolve) => {
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
      finish = resolve;
    }));

    const first = dispatcher.dispatch("session:open:artifact:4:2", sender);
    const duplicate = dispatcher.dispatch("session:open:artifact:4:2", sender);
    expect(sender).toHaveBeenCalledTimes(1);
    finish("committed");
    await expect(Promise.all([first, duplicate])).resolves.toEqual(["committed", "committed"]);
  });
});
