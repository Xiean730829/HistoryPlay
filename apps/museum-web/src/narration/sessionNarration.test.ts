import { describe, expect, it, vi } from "vitest";
import { acquireSessionNarration, attachSessionNarrationTransport, splitFixedNarration } from "./sessionNarration";

describe("会话朗读通道", () => {
  it("长度允许时每两句一起发送，保持正文和单次上限", () => {
    expect(splitFixedNarration("这是一枚开元通宝。它的馆藏断代是718至732年。想听它背后的故事吗？"))
      .toEqual(["这是一枚开元通宝。它的馆藏断代是718至732年。", "想听它背后的故事吗？"]);
  });
  it("固定稿按完整标点边界拆分为小智单次长度内的片段", () => {
    const text = "第一段内容。".repeat(25);
    const chunks = splitFixedNarration(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => Array.from(chunk).length + Array.from("请重复下面这句话：").length <= 80)).toBe(true);
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

  it("多片段失败后重试当前片段，不把失败伪装成下一句", async () => {
    const runtime = acquireSessionNarration("session-chunks");
    const narrate = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("字幕不一致"))
      .mockResolvedValue(undefined);
    const detach = attachSessionNarrationTransport("session-chunks", { narrate });
    const text = "第一段内容。".repeat(25);
    await expect(runtime.player.play({
      packId: "cn.tang.core", version: "0.3.2", contentId: "chunk-retry", role: "answer", text,
    })).rejects.toThrow("第2/");
    expect(narrate).toHaveBeenCalledTimes(2);
    await expect(runtime.player.play({
      packId: "cn.tang.core", version: "0.3.2", contentId: "chunk-retry", role: "answer", text,
    })).resolves.toBe(true);
    expect(narrate.mock.calls[2][4]).toMatchObject({ chunkIndex: 1 });
    detach();
    runtime.release();
  });

  it("双句被小智截断时回退逐句，全部完成后才算讲述完成", async () => {
    const runtime = acquireSessionNarration("paired-fallback");
    const narrate = vi.fn().mockRejectedValueOnce(new Error("小智语音字幕与固定正文不一致，故事不会自动翻页"))
      .mockResolvedValue(undefined);
    const detach = attachSessionNarrationTransport("paired-fallback", { narrate });
    await expect(runtime.player.play({ packId: "cn.tang.core", version: "0.3.8", contentId: "node",
      text: "这是第一句。这是第二句。", role: "story" })).resolves.toBe(true);
    expect(narrate.mock.calls.map((call) => call[1])).toEqual([
      "这是第一句。这是第二句。", "这是第一句。", "这是第二句。",
    ]);
    detach(); runtime.release();
  });
});
