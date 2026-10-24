import { describe, expect, it } from "vitest";
import { acquireSessionNarration } from "./sessionNarration";

describe("会话朗读通道", () => {
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
