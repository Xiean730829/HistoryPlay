import { describe, expect, it } from "vitest";
import { AudioFocus } from "../narration/AudioFocus";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import type { NarrationAdapter, NarrationSegment } from "../narration/NarrationPlayer";
import { StoryAutoplayController } from "./StoryAutoplayController";

function fixture(artifactId = "artifact-1") {
  const requests: Array<{
    segment: NarrationSegment; signal: AbortSignal; start(): void; finish(): void;
  }> = [];
  const adapter: NarrationAdapter = { play: (segment, signal, onStarted) => new Promise((resolve) => {
    requests.push({ segment, signal, start: onStarted, finish: resolve });
  }) };
  const narration = new NarrationPlayer(adapter, new AudioFocus());
  const advanced: string[] = [];
  const controller = new StoryAutoplayController(narration, (key) => advanced.push(key));
  const identity = {
    sessionId: "session", artifactId, storyId: "story", nodeId: "node-1",
    revision: 4, interactionEpoch: 2,
  };
  const segment = { packId: "cn.tang.core", version: "1.0.0", contentId: "node-1", text: "固定故事正文" };
  return { controller, narration, requests, advanced, identity, segment };
}

describe("故事固定稿自动推进", () => {
  it("必须等真实出声后再完成，且同一节点至多推进一次", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const key = JSON.stringify(identity);
    const playing = controller.start(identity, segment, true);
    expect(advanced).toEqual([]);
    expect(await controller.start(identity, segment, true)).toBe(false);
    expect(requests).toHaveLength(1);
    requests[0].start();
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(advanced).toEqual([key]);
    const retried = controller.retry();
    expect(requests).toHaveLength(2);
    requests[1].start();
    requests[1].finish();
    expect(await retried).toBe(true);
    expect(advanced).toEqual([key]);
  });

  it("音频从未开始就结束时不推进，也不声称已播放", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(advanced).toEqual([]);
    expect(controller.isPlaybackAuthorized(identity)).toBe(false);
  });

  it("被语音抢占时冻结，不翻页；继续只重播原片段并在出声完成后再翻页", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    requests[0].start();
    narration.stop();
    requests[0].finish();
    expect(await playing).toBe(false);
    expect(advanced).toEqual([]);
    const resumed = narration.resume();
    expect(requests[1].segment).toEqual({ ...segment, role: "story" });
    requests[1].start();
    requests[1].finish();
    expect(await resumed).toBe(true);
    expect(advanced).toEqual([JSON.stringify(identity)]);
  });

  it("两次继续仍停在同一幕，只有再次出声完成才推进一次", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    requests[0].start();
    narration.stop();
    requests[0].finish();
    expect(await playing).toBe(false);
    const firstResume = narration.resume();
    requests[1].start();
    narration.stop();
    requests[1].finish();
    expect(await firstResume).toBe(false);
    const secondResume = narration.resume();
    expect(requests[2].segment.contentId).toBe("node-1");
    requests[2].start();
    requests[2].finish();
    expect(await secondResume).toBe(true);
    expect(advanced).toEqual([JSON.stringify(identity)]);
  });

  it("新交互版本撤销旧播放的推进权，明确继续后以新版本完成原片段", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    requests[0].start();
    narration.stop();
    const resumedIdentity = { ...identity, revision: 5, interactionEpoch: 3 };
    controller.updateIdentity(resumedIdentity);
    requests[0].finish();
    expect(await playing).toBe(false);
    expect(advanced).toEqual([]);

    const resumed = narration.resume();
    requests[1].start();
    requests[1].finish();
    expect(await resumed).toBe(true);
    expect(advanced).toEqual([JSON.stringify(resumedIdentity)]);
  });

  it("切到另一件文物后，旧完成信号不能推进新状态", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const first = controller.start(identity, segment, true);
    requests[0].start();
    const nextIdentity = { ...identity, artifactId: "artifact-2", nodeId: "node-2", revision: 5 };
    const nextSegment = { ...segment, contentId: "node-2", text: "第二件第一幕" };
    const second = controller.start(nextIdentity, nextSegment, true);
    requests[0].finish();
    expect(await first).toBe(false);
    expect(advanced).toEqual([]);
    requests[1].start();
    requests[1].finish();
    expect(await second).toBe(true);
    expect(advanced).toEqual([JSON.stringify(nextIdentity)]);
  });

  it("节点身份改变或退出画卷后，迟到的旧完成不能推进", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const first = controller.start(identity, segment, true);
    const nextIdentity = { ...identity, nodeId: "node-2", revision: 5 };
    const nextSegment = { ...segment, contentId: "node-2", text: "第二幕" };
    const second = controller.start(nextIdentity, nextSegment, true);
    requests[0].finish();
    expect(await first).toBe(false);
    expect(advanced).toEqual([]);
    controller.leave();
    requests[1].finish();
    expect(await second).toBe(false);
    expect(advanced).toEqual([]);
  });

  it("首幕真实出声完成后才提交继续；末幕完成不会自动提交", async () => {
    const firstAct = fixture();
    const firstPlaying = firstAct.controller.start(firstAct.identity, firstAct.segment, true);
    firstAct.requests[0].start();
    firstAct.requests[0].finish();
    expect(await firstPlaying).toBe(true);
    expect(firstAct.advanced).toEqual([JSON.stringify(firstAct.identity)]);

    const lastAct = fixture();
    const lastIdentity = { ...lastAct.identity, nodeId: "node-3", revision: 6 };
    const lastSegment = { ...lastAct.segment, contentId: "node-3", text: "最后一幕" };
    const lastPlaying = lastAct.controller.start(lastIdentity, lastSegment, false);
    lastAct.requests[0].start();
    lastAct.requests[0].finish();
    expect(await lastPlaying).toBe(true);
    expect(lastAct.advanced).toEqual([]);
  });

  it("文字返回或准备事件不会提前切画", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    expect(narration.getCheckpoint().state).toBe("preparing");
    expect(advanced).toEqual([]);
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(advanced).toEqual([]);
  });

  it("缺少当前展品或故事身份时不能开始讲述", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    expect(await controller.start({ ...identity, artifactId: "" }, segment, true)).toBe(false);
    expect(await controller.start({ ...identity, sessionId: "" }, segment, true)).toBe(false);
    expect(requests).toHaveLength(0);
    expect(advanced).toEqual([]);
  });
});
