import { describe, expect, it, vi } from "vitest";
import { connectAfterHandoff } from "./handoffRetry";

describe("voice handoff", () => {
  it("retries a transient upgrade failure during an automatic handoff", async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error("语音连接失败：浏览器WebSocket代理（upgrade_error）")).mockResolvedValueOnce(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await connectAfterHandoff(connect, true, () => true, wait);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(700);
  });
  it("does not retry other failures or a manual connection", async () => {
    const failure = new Error("语音绑定失败");
    const connect = vi.fn().mockRejectedValue(failure);
    await expect(connectAfterHandoff(connect, true, () => true)).rejects.toThrow("语音绑定失败");
    await expect(connectAfterHandoff(connect, false, () => true)).rejects.toThrow("语音绑定失败");
    expect(connect).toHaveBeenCalledTimes(2);
  });
  it("stops retrying after the panel is gone", async () => {
    let active = true;
    const connect = vi.fn().mockRejectedValue(new Error("浏览器WebSocket代理（upgrade_error）"));
    await expect(connectAfterHandoff(connect, true, () => active, async () => { active = false; })).rejects.toThrow();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
