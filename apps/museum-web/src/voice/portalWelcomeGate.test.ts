import { describe, expect, it } from "vitest";
import { claimPortalWelcome, type WelcomeAttemptStorage } from "./portalWelcomeGate";

class MemoryStorage implements WelcomeAttemptStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("入口欢迎语门控", () => {
  it("每个参观会话只领取一次，重连不重复欢迎", () => {
    const storage = new MemoryStorage();
    expect(claimPortalWelcome("session-one", storage)).toBe(true);
    expect(claimPortalWelcome("session-one", storage)).toBe(false);
    expect(claimPortalWelcome("session-two", storage)).toBe(true);
  });

  it("即使浏览器存储不可用，也会在当前页面会话内去重", () => {
    expect(claimPortalWelcome("memory-only", null)).toBe(true);
    expect(claimPortalWelcome("memory-only", null)).toBe(false);
  });
});
