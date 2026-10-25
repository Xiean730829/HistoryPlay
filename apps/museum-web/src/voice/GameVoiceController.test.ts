import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import { GameVoiceController } from "./GameVoiceController";
import type { VoiceControlResult } from "./VoiceClient";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("定位并实际呈现展品后由小智朗读固定正文，再邀请进入可用故事", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const onStatus = vi.fn();
    const artifact = {
      id: "cn.tang.artifact.stele", title: "造像碑", museum: "唐代馆", time_range: { start: 618, end: 907 },
      material: "石", category: "造像", asset_ids: [], fact_card_ids: [],
      story_entry_ids: ["cn.tang.story.stele"],
    };
    const session = {
      session_id: "test-session", session_token: "local-test-token", connection_id: "local-test-connection",
      control_ticket: "unused", pack_id: "cn.tang.core", version: "0.2.4",
      state: { revision: 7, view_revision: 4, interaction_epoch: 2, focused_entity_id: artifact.id },
      context: { session_id: "test-session", revision: 7, event_seq: 10, mode: "explore",
        focused_artifact: artifact, visible_artifacts: [artifact], story_node: null },
    } as unknown as ActiveSession;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/context")) return new Response(JSON.stringify(session.context), { status: 200 });
      if (url.includes("/content?")) return new Response(JSON.stringify({
        content_id: artifact.id, content_kind: "artifact", pack_id: "cn.tang.core", version: "0.2.4",
        title: "造像碑", artifact_id: artifact.id, paragraphs: [{ content_id: artifact.id, version: "0.2.4",
          paragraph_number: 1, text: "这是一段经过校订的造像碑讲解。",
          authorship: { node_id: artifact.id, story_id: null, fact_grade: "established" },
          presentation: null, allowed_actions: [] }], next_cursor: null,
      }), { status: 200 });
      return new Response(JSON.stringify(session.state), { status: 200 });
    }));
    const controller = new GameVoiceController(session, {
      onStatus, onTranscript: vi.fn(), onRefresh: async () => "rendered",
    });
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({ kind: "action", receipt: {
      action: "locate_artifact", status: "committed", request_id: "locate-1", revision: 7,
    } as CommandReceipt });
    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.calls[0][0]).toMatchObject({
      role: "answer", contentId: artifact.id, text: "这是一段经过校订的造像碑讲解。",
    });
    expect(play.mock.calls[1][0].text).toContain("进入故事");
    expect(onStatus).toHaveBeenCalledWith("展品已就位，小智正在讲解固定正文");
    expect(onStatus).toHaveBeenCalledWith("展品介绍完成，小智正在邀请你进入故事");
    controller.dispose();
  });

  it("入馆欢迎语通过同一小智实时语音通道播放", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const controller = new GameVoiceController({
      session_id: "test-session", pack_id: "cn.tang.core", version: "0.2.4",
    } as ActiveSession, { onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = { disconnect: vi.fn() };
    await controller.speakWelcome();
    expect(play).toHaveBeenCalledWith({
      packId: "cn.tang.core", version: "0.2.4", contentId: "museum.portal.welcome", role: "answer",
      text: "欢迎来到时空博物馆，要我带你进去沿着时间长河欣赏文物的发展吗？",
    });
    controller.dispose();
  });

  it("展品固定正文尚在播放时用户插话，不再播放进入故事的邀请", async () => {
    let finishIntro!: (completed: boolean) => void;
    const play = vi.spyOn(NarrationPlayer.prototype, "play")
      .mockImplementationOnce(() => new Promise((resolve) => { finishIntro = resolve; }))
      .mockResolvedValue(true);
    const artifact = {
      id: "cn.tang.artifact.stele", title: "造像碑", museum: "唐代馆", time_range: { start: 618, end: 907 },
      material: "石", category: "造像", asset_ids: [], fact_card_ids: [],
      story_entry_ids: ["cn.tang.story.stele"],
    };
    const session = {
      session_id: "test-session", session_token: "local-test-token", connection_id: "local-test-connection",
      pack_id: "cn.tang.core", version: "0.2.4",
      state: { revision: 7, view_revision: 4, interaction_epoch: 2, focused_entity_id: artifact.id },
      context: { session_id: "test-session", revision: 7, event_seq: 10, mode: "explore",
        focused_artifact: artifact, visible_artifacts: [artifact], story_node: null },
    } as unknown as ActiveSession;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/context")) return new Response(JSON.stringify(session.context), { status: 200 });
      if (url.includes("/content?")) return new Response(JSON.stringify({
        content_id: artifact.id, content_kind: "artifact", pack_id: "cn.tang.core", version: "0.2.4",
        title: "造像碑", artifact_id: artifact.id, paragraphs: [{ content_id: artifact.id, version: "0.2.4",
          paragraph_number: 1, text: "这是一段经过校订的造像碑讲解。",
          authorship: { node_id: artifact.id, story_id: null, fact_grade: "established" },
          presentation: null, allowed_actions: [] }], next_cursor: null,
      }), { status: 200 });
      return new Response(JSON.stringify(session.state), { status: 200 });
    }));
    const controller = new GameVoiceController(session, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "rendered",
    });
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    const intro = handler.control({ kind: "action", receipt: {
      action: "locate_artifact", status: "committed", request_id: "locate-interrupt", revision: 7,
    } as CommandReceipt });
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    controller.beginTurn();
    finishIntro(true);
    await intro;
    expect(play).toHaveBeenCalledTimes(1);
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
