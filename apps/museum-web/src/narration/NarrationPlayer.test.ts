import { describe, expect, it, vi } from "vitest";
import { AudioFocus } from "./AudioFocus";
import { NarrationPlayer } from "./NarrationPlayer";
import type { NarrationAdapter, NarrationSegment } from "./NarrationPlayer";

const segment = { packId: "cn.tang.core", version: "0.2.0", contentId: "node-coin-1", text: "这是固定正文。" };

function fixture() {
  const requests: { segment: NarrationSegment; signal: AbortSignal; start(): void;
    finish(): void; fail(error: Error): void }[] = [];
  const adapter: NarrationAdapter = { play: (part, signal, start) => new Promise((finish, fail) => {
    requests.push({ segment: part, signal, start, finish, fail });
  }) };
  const focus = new AudioFocus();
  return { player: new NarrationPlayer(adapter, focus), focus, requests };
}

describe("固定稿与音频焦点", () => {
  it("播放开始和完成分开记录，真实结束前不能标为已读完", async () => {
    const { player, requests } = fixture();
    const playing = player.play(segment);
    expect(player.getCheckpoint().state).toBe("preparing");
    requests[0].start();
    expect(player.getCheckpoint().lastStarted).toBe(segment.contentId);
    expect(player.getCheckpoint().lastCompleted).toBeNull();
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(player.getCheckpoint().lastCompleted).toBe(segment.contentId);
  });
  it("追问抢占时停止旧声，继续仍从同片段开头朗读", async () => {
    const { player, focus, requests } = fixture();
    const old = player.play(segment); requests[0].start();
    const qaStop = vi.fn();
    const qa = focus.claim("qa", qaStop);
    expect(requests[0].signal.aborted).toBe(true);
    expect(player.getCheckpoint().state).toBe("interrupted");
    const resumed = player.resume();
    expect(qaStop).toHaveBeenCalledOnce();
    qa.release();
    expect(focus.owner).toBe("narration");
    expect(requests[1].segment).toEqual(segment);
    requests[0].finish(); expect(await old).toBe(false);
    expect(player.getCheckpoint().lastCompleted).toBeNull();
    requests[1].start(); requests[1].finish();
    expect(await resumed).toBe(true);
  });
  it("朗读追问答复不会覆盖被打断的故事恢复点", async () => {
    const { player, requests } = fixture();
    const story = { ...segment, role: "story" as const };
    const answer = { ...segment, contentId: "answer-1", text: "这是追问答复。", role: "answer" as const };
    const firstPlay = player.play(story); requests[0].start();
    player.stop();
    requests[0].finish();
    expect(await firstPlay).toBe(false);
    const answerPlay = player.play(answer); requests[1].start(); requests[1].finish();
    expect(await answerPlay).toBe(true);
    const resumedStory = player.resume();
    expect(requests[2].segment).toEqual(story);
    requests[2].start(); requests[2].finish();
    expect(await resumedStory).toBe(true);
    expect(player.getCheckpoint().lastCompleted).toBe(story.contentId);
  });
  it("离开后迟到回调不能标完成，也不能复活故事", async () => {
    const { player, requests } = fixture();
    const playing = player.play(segment); requests[0].start();
    player.leave(); requests[0].finish();
    expect(await playing).toBe(false);
    expect(player.getCheckpoint().state).toBe("idle");
    expect(player.getCheckpoint().lastCompleted).toBeNull();
    expect(await player.resume()).toBe(false);
  });
  it("适配器失败释放焦点，不能误报完成", async () => {
    const { player, focus, requests } = fixture();
    const playing = player.play(segment);
    requests[0].fail(new Error("断网"));
    await expect(playing).rejects.toThrow("断网");
    expect(focus.owner).toBeNull();
    expect(player.getCheckpoint().state).toBe("error");
    expect(player.getCheckpoint().lastCompleted).toBeNull();
  });
});
