import { describe, expect, it } from "vitest";
import { acquireSessionNarration, splitFixedNarration } from "./sessionNarration";

describe("会话朗读通道", () => {
  it("固定稿按完整标点边界拆分为小智单次长度内的片段", () => {
    const text = "第一段内容。".repeat(25);
    const chunks = splitFixedNarration(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => Array.from(chunk).length + Array.from("请逐字朗读：").length <= 80)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });
  it("同一游戏会话共用音频焦点和恢复点，最后一个使用者离开后释放", () => {
    const storyStage = acquireSessionNarration("session-1");
    const voicePanel = acquireSessionNarration("session-1");
    expect(voicePanel.player).toBe(storyStage.player);
    expect(voicePanel.focus).toBe(storyStage.focus);

    storyStage.release();
    expect(voicePanel.player).toBe(storyStage.player);
    voicePanel.release();

    const next = acquireSessionNarration("session-1");
    expect(next.player).not.toBe(storyStage.player);
    next.release();
  });
});
