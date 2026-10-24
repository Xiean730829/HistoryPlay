import { describe, expect, it } from "vitest";
import { AudioFocus } from "../narration/AudioFocus";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import type { NarrationAdapter, NarrationSegment } from "../narration/NarrationPlayer";
import { StoryAutoplayController } from "./StoryAutoplayController";

function fixture() {
  const requests: Array<{ segment: NarrationSegment; signal: AbortSignal; finish(): void }> = [];
  const adapter: NarrationAdapter = { play: (segment, signal) => new Promise((resolve) => {
    requests.push({ segment, signal, finish: resolve });
  }) };
  const narration = new NarrationPlayer(adapter, new AudioFocus());
  const advanced: string[] = [];
  const controller = new StoryAutoplayController(narration, (key) => advanced.push(key));
  const identity = { sessionId: "session", storyId: "story", nodeId: "node-1", revision: 4, interactionEpoch: 2 };
  const segment = { packId: "cn.tang.core", version: "1.0.0", contentId: "node-1", text: "固定故事正文" };
  return { controller, narration, requests, advanced, identity, segment };
}

describe("故事固定稿自动推进", () => {
  it("必须等真实朗读完成，且同一节点至多推进一次", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const key = JSON.stringify(identity);
    const playing = controller.start(identity, segment, true);
    expect(advanced).toEqual([]);
    expect(await controller.start(identity, segment, true)).toBe(false);
    expect(requests).toHaveLength(1);
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(advanced).toEqual([key]);
  });

  it("被语音抢占时冻结，不翻页；继续只重播原片段并在播放完后再翻页", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    narration.stop();
    requests[0].finish();
    expect(await playing).toBe(false);
    expect(advanced).toEqual([]);
    const resumed = narration.resume();
    expect(requests[1].segment).toEqual({ ...segment, role: "story" });
    requests[1].finish();
    expect(await resumed).toBe(true);
    expect(advanced).toEqual([JSON.stringify(identity)]);
  });

  it("新交互版本撤销旧播放的推进权，明确继续后以新版本完成原片段", async () => {
    const { controller, narration, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, true);
    narration.stop();
    const resumedIdentity = { ...identity, revision: 5, interactionEpoch: 3 };
    controller.updateIdentity(resumedIdentity);
    requests[0].finish();
    expect(await playing).toBe(false);
    expect(advanced).toEqual([]);

    const resumed = narration.resume();
    requests[1].finish();
    expect(await resumed).toBe(true);
    expect(advanced).toEqual([JSON.stringify(resumedIdentity)]);
  });

  it("节点身份改变或退出后，旧完成信号不能推进新状态", async () => {
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

  it("没有合法下一节点时，朗读完成也不会自动提交继续命令", async () => {
    const { controller, requests, advanced, identity, segment } = fixture();
    const playing = controller.start(identity, segment, false);
    requests[0].finish();
    expect(await playing).toBe(true);
    expect(advanced).toEqual([]);
  });
});
