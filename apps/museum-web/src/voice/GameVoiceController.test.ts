import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import { GameVoiceController } from "./GameVoiceController";
import type { VoiceControlResult } from "./VoiceClient";

afterEach(() => vi.restoreAllMocks());

describe("语音控制与画面刷新竞态", () => {
  it("进入故事后释放一次性问答焦点，不会因自动讲述关闭当前小智连接", async () => {
    const interrupt = vi.fn();
    const disconnect = vi.fn();
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending",
      onStoryTransition: vi.fn(),
    });
    (controller as unknown as { voice: unknown }).voice = {
      beginTurn: vi.fn().mockResolvedValue(undefined), interrupt, disconnect,
    };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    controller.beginTurn();
    await handler.control({ kind: "action", receipt: {
      action: "enter_story", status: "committed",
    } as CommandReceipt });

    const stopStory = vi.fn();
    const lease = (controller as unknown as { focus: { claim(owner: string, stop: () => void): { release(): void } } })
      .focus.claim("narration", stopStory);
    expect(interrupt).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    lease.release();
    controller.dispose();
  });

  it("刷新等待期间出现新问题，旧动作完成不能迟到开始朗读", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    let release!: () => void;
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: () => new Promise<"rendered" | "degraded" | "pending">((resolve) => { release = () => resolve("rendered"); }),
    });
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    const pending = handler.control({ kind: "action",
      receipt: { action: "enter_story" } as CommandReceipt,
      narration: { packId: "cn.tang.core", version: "1", contentId: "old-node", text: "旧正文" },
    });
    controller.beginTurn();
    release();
    await pending;
    expect(play).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("固定正文只作为小智上下文，不把浏览器语音冒充实时讲解员", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const onTranscript = vi.fn();
    const onStatus = vi.fn();
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus, onTranscript, onRefresh: async () => "pending",
    });
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({ kind: "narration", narration: {
      packId: "cn.tang.core", version: "1", contentId: "artifact-1", text: "固定正文",
    } });
    expect(play).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith("已读取当前文物的固定讲解稿，等待讲解员实时讲解");
    controller.dispose();
  });

  it("只有当前定位请求得到真实画面回执后才释放小智云端回复", async () => {
    let resolveRender!: (status: "rendered" | "degraded" | "pending") => void;
    const acknowledgeRender = vi.fn();
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: () => new Promise((resolve) => { resolveRender = resolve; }),
    });
    (controller as unknown as { voice: unknown }).voice = { acknowledgeRender, disconnect: vi.fn(), interrupt: vi.fn() };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    const pending = handler.control({ kind: "action", receipt: {
      action: "locate_artifact", request_id: "nav-current", status: "committed",
    } as CommandReceipt });
    await Promise.resolve();
    expect(acknowledgeRender).not.toHaveBeenCalled();
    resolveRender("rendered");
    await pending;
    expect(acknowledgeRender).toHaveBeenCalledWith("nav-current", "rendered");
    controller.dispose();
  });

  it("pending或过期到达会丢弃候选讲解，不把旧文物语音带到下一轮", async () => {
    const acknowledgeRender = vi.fn();
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending",
    });
    (controller as unknown as { voice: unknown }).voice = { acknowledgeRender, disconnect: vi.fn(), interrupt: vi.fn() };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({ kind: "action", receipt: {
      action: "move_next", request_id: "nav-pending", status: "committed",
    } as CommandReceipt });
    expect(acknowledgeRender).toHaveBeenCalledWith("nav-pending", "pending");

    let resolveRender!: (status: "rendered" | "degraded" | "pending") => void;
    const stale = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: () => new Promise((resolve) => { resolveRender = resolve; }),
    });
    const staleAck = vi.fn();
    (stale as unknown as { voice: unknown }).voice = { acknowledgeRender: staleAck, disconnect: vi.fn(), interrupt: vi.fn() };
    const staleHandler = stale as unknown as { control(result: VoiceControlResult): Promise<void> };
    const old = staleHandler.control({ kind: "action", receipt: {
      action: "locate_artifact", request_id: "nav-old", status: "committed",
    } as CommandReceipt });
    await Promise.resolve();
    (stale as unknown as { inputSequence: number }).inputSequence += 1;
    resolveRender("rendered");
    await old;
    expect(staleAck).not.toHaveBeenCalled();
    controller.dispose(); stale.dispose();
  });

  it("已经在当前展位的拒绝定位不会等不存在的新画面回执", async () => {
    const acknowledgeRender = vi.fn();
    const onRefresh = vi.fn(async () => "pending" as const);
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh,
    });
    (controller as unknown as { voice: unknown }).voice = {
      acknowledgeRender, disconnect: vi.fn(), interrupt: vi.fn(),
    };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({ kind: "action", receipt: {
      action: "locate_artifact", request_id: "same-station", status: "rejected",
    } as CommandReceipt });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(acknowledgeRender).not.toHaveBeenCalled();
    controller.dispose();
  });
});
