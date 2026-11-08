import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { NarrationPlayer } from "../narration/NarrationPlayer";
import { GameVoiceController, isStoryOfferConsent } from "./GameVoiceController";
import type { VoiceControlResult } from "./VoiceClient";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("语音控制与画面刷新竞态", () => {
  it.each(["rendered", "degraded"] as const)("翻组得到%s画面结果后才播报实际结果", async (status) => {
    let finish!: (status: "rendered" | "degraded") => void;
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const controller = new GameVoiceController({
      session_id: "browse-confirmation", pack_id: "cn.tang.core", version: "0.3.3",
    } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: () => new Promise((resolve) => { finish = resolve; }),
    });
    (controller as unknown as { voice: unknown }).voice = {
      hasControlledReply: () => true, acknowledgeRender: vi.fn(), disconnect: vi.fn(),
    };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    const pending = handler.control({ kind: "action", receipt: {
      action: "browse_gallery", status: "committed", request_id: "browse-real-frame",
    } as CommandReceipt });
    expect(play).not.toHaveBeenCalled();
    finish(status);
    await pending;
    expect(play).toHaveBeenCalledOnce();
    expect(play.mock.calls[0][0].text).toContain(status === "rendered" ? "已切换展厅总览" : "还没有带你过去");
    controller.dispose();
  });

  it("多件候选必须由同一实时通道问清楚，不让云端猜一件牛", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const controller = new GameVoiceController({
      session_id: "ambiguous-confirmation", pack_id: "cn.tang.core", version: "0.3.3",
    } as ActiveSession, { onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = { hasControlledReply: () => true, disconnect: vi.fn() };
    await (controller as unknown as { control(result: VoiceControlResult): Promise<void> }).control({
      kind: "clarification", message: "找到两件：吹笛乐俑、弹拨乐俑。你想看哪件？",
    });
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ text: "找到两件：吹笛乐俑、弹拨乐俑。你想看哪件？", role: "answer" }));
    controller.dispose();
  });
  it.each(["可以", "好", "好的", "好啊，讲吧", "当然", "没问题", "嗯，可以进入故事", "那就听听"]) (
    "把故事邀请后的确认 %s 识别为一次性同意",
    (text) => { expect(isStoryOfferConsent(text)).toBe(true); },
  );

  it.each(["不可以", "先等等", "讲讲佛像", "进入故事了吗"]) (
    "不会把非确认内容 %s 误当成故事同意",
    (text) => { expect(isStoryOfferConsent(text)).toBe(false); },
  );

  it("后台介绍命令播放服务端固定正文，不让云端自由回答接管讲解", async () => {
    const fixedIntro = vi.spyOn(
      GameVoiceController.prototype as unknown as {
        speakFocusedArtifact(sequence: number, revision?: number, narration?: VoiceControlResult["narration"]): Promise<void>;
      },
      "speakFocusedArtifact",
    ).mockResolvedValue(undefined);
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending",
    });
    const narration = {
      packId: "cn.tang.core", version: "0.2.4",
      contentId: "cn.tang.artifact.stele", text: "校订过的佛像介绍",
    };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };

    await handler.control({ kind: "narration", narration });

    expect(fixedIntro).toHaveBeenCalledWith(0, undefined, narration);
    controller.dispose();
  });

  it("重新聚焦只在画面真实呈现后播放当前文物固定介绍", async () => {
    const speak = vi.spyOn(
      GameVoiceController.prototype as unknown as {
        speakFocusedArtifact(sequence: number, revision?: number, narration?: VoiceControlResult["narration"]): Promise<void>;
      },
      "speakFocusedArtifact",
    ).mockResolvedValue(undefined);
    const acknowledgeRender = vi.fn();
    const context = {
      revision: 7, mode: "explore", story_node: null,
      focused_artifact: { id: "cn.tang.artifact.stele" },
    };
    const state = { revision: 7 };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).endsWith("/context") ? context : state), { status: 200 }),
    ));
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending",
      onPresentation: async () => "rendered",
    });
    (controller as unknown as { voice: unknown }).voice = { acknowledgeRender, disconnect: vi.fn() };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };

    await handler.control({ kind: "action", message: "正在重新走近", render_status: "pending",
      presentation_action: "focus_current", presentation_request_id: "focus-1",
      presentation_expected_focus_id: "cn.tang.artifact.stele", presentation_expected_revision: 7,
    });

    expect(acknowledgeRender).toHaveBeenCalledWith("focus-1", "rendered");
    expect(speak).toHaveBeenCalledWith(0, 7);
    controller.dispose();
  });

  it("继续从被打断的同一幕恢复，不会在恢复前翻页", async () => {
    const resume = vi.spyOn(NarrationPlayer.prototype, "resume").mockResolvedValue(true);
    const onStatus = vi.fn();
    const controller = new GameVoiceController({ session_id: "resume-same-act" } as ActiveSession, {
      onStatus, onTranscript: vi.fn(), onRefresh: async () => "pending",
    });
    await (controller as unknown as { control(result: VoiceControlResult): Promise<void> }).control({ kind: "resume" });
    expect(resume).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith("正在从刚才停下的同一幕继续");
    controller.dispose();
  });

  it("没有被打断片段时继续不假装已播放", async () => {
    vi.spyOn(NarrationPlayer.prototype, "resume").mockResolvedValue(false);
    const onStatus = vi.fn();
    const controller = new GameVoiceController({ session_id: "resume-empty" } as ActiveSession, {
      onStatus, onTranscript: vi.fn(), onRefresh: async () => "pending",
    });
    await (controller as unknown as { control(result: VoiceControlResult): Promise<void> }).control({ kind: "resume" });
    expect(onStatus).toHaveBeenCalledWith("当前没有被打断的讲解片段，画面仍停在这一幕");
    controller.dispose();
  });

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

  it("邀请开始出声时即登记，尾音期间说可以也能进入故事", async () => {
    const artifact = { id: "cn.tang.artifact.bull", title: "牛", story_entry_ids: ["cn.tang.story.bull"],
      presentation: { background_node_id: "cn.tang.node.bull.01" } };
    const state = { revision: 7, view_revision: 1, interaction_epoch: 1, mode: "explore" };
    const context = { revision: 7, mode: "explore", story_node: null, focused_artifact: artifact };
    const session = { session_id: "offer-audio", session_token: "test", connection_id: "test",
      control_ticket: "test", pack_id: "cn.tang.core", version: "0.3.8", state, context } as unknown as ActiveSession;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return new Response(JSON.stringify({ status: "committed", action: "enter_story", request_id: "story" }), { status: 200 });
      if (url.endsWith("/context")) return new Response(JSON.stringify(context), { status: 200 });
      if (url.includes("/content?")) return new Response(JSON.stringify({ content_id: artifact.id,
        content_kind: "background", pack_id: session.pack_id, version: session.version, artifact_id: artifact.id,
        paragraphs: [{ content_id: "cn.tang.node.bull.01", text: "这是介绍。",
          authorship: { node_id: "cn.tang.node.bull.01", story_id: "cn.tang.story.bull" } }] }), { status: 200 });
      return new Response(JSON.stringify(state), { status: 200 });
    }));
    let listener: Parameters<NarrationPlayer["subscribe"]>[0] | undefined;
    vi.spyOn(NarrationPlayer.prototype, "subscribe").mockImplementation((callback) => { listener = callback; return () => {}; });
    let finishInvitation!: (value: boolean) => void;
    vi.spyOn(NarrationPlayer.prototype, "play").mockImplementation(async (segment) => {
      if (segment.text !== "想听它背后的故事吗？") return true;
      listener?.({ state: "playing", lastStarted: segment.contentId, lastCompleted: null }, segment);
      return new Promise<boolean>((resolve) => { finishInvitation = resolve; });
    });
    const transition = vi.fn();
    const controller = new GameVoiceController(session, { onStatus: vi.fn(), onTranscript: vi.fn(),
      onRefresh: async () => "rendered", onStoryTransition: transition });
    const intro = controller.noteClickInspection(artifact.id, 7);
    const guide = (controller as unknown as { guide: { currentOffer(): unknown; acceptConsentFromTranscript(text: string, id: string): Promise<boolean> } }).guide;
    await vi.waitFor(() => expect(guide.currentOffer()).not.toBeNull());
    expect(await guide.acceptConsentFromTranscript("可以", "offer-answer")).toBe(true);
    expect(transition).toHaveBeenCalledWith("enter_story");
    finishInvitation(false);
    await intro;
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

  it.each(["votive-stele", "kaiyuan-coin", "gilt-bronze-bull", "lute-musician",
    "flute-musician", "woman-figure-mia", "buddha-follower", "dvarapala"])
  ("定位%s并实际呈现后朗读自己的背景节点，再邀请进入故事", async (suffix) => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const onStatus = vi.fn();
    const backgroundId = `cn.tang.node.${suffix}.01`;
    const storyId = `cn.tang.story.${suffix}`;
    const artifact = {
      id: `cn.tang.artifact.${suffix}`, title: "当前文物", museum: "唐代馆", time_range: { start: 618, end: 907 },
      material: "石", category: "造像", asset_ids: [], fact_card_ids: [],
      story_entry_ids: [storyId],
      presentation: { background_node_id: backgroundId },
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
        content_id: artifact.id, content_kind: "background", pack_id: "cn.tang.core", version: "0.2.4",
        title: "造像碑", artifact_id: artifact.id, paragraphs: [{ content_id: backgroundId, version: "0.2.4",
          paragraph_number: 1, text: "这是一段经过校订的造像碑讲解。",
          authorship: { node_id: backgroundId, story_id: storyId, fact_grade: "established" },
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
      role: "answer", contentId: backgroundId, text: "这是一段经过校订的造像碑讲解。",
    });
    expect(play.mock.calls[1][0].text).toBe("想听它背后的故事吗？");
    expect(onStatus).toHaveBeenCalledWith("展品已就位，小智正在讲解固定正文");
    expect(onStatus).toHaveBeenCalledWith("展品介绍完成，小智正在邀请你进入故事");
    // The explicit “介绍这个文物” route returns a node ID too, rather than
    // the artifact ID. It must use the same validated intro as arrival.
    await handler.control({ kind: "narration", narration: {
      packId: "cn.tang.core", version: "0.2.4", contentId: backgroundId,
      text: "这是一段经过校订的造像碑讲解。",
    } });
    expect(play).toHaveBeenCalledTimes(4);
    controller.dispose();
  });

  it("入馆欢迎语通过同一小智实时语音通道播放", async () => {
    const onStatus = vi.fn();
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const controller = new GameVoiceController({
      session_id: "test-session", pack_id: "cn.tang.core", version: "0.2.4",
    } as ActiveSession, { onStatus, onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = { disconnect: vi.fn() };
    await controller.speakWelcome();
    expect(play).toHaveBeenCalledWith({
      packId: "cn.tang.core", version: "0.2.4", contentId: "museum.portal.welcome", role: "answer",
      text: "欢迎来到时空博物馆，要我带你进去沿着时间长河欣赏文物的发展吗？",
    });
    expect(onStatus).toHaveBeenCalledWith("欢迎语已播完，请说“可以”进入博物馆");
    controller.dispose();
  });

  it("切馆前停止旧讲解，候选入口欢迎语要求明确说朝代", async () => {
    const onStatus = vi.fn();
    const stop = vi.spyOn(NarrationPlayer.prototype, "stop").mockImplementation(() => undefined);
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const controller = new GameVoiceController({
      session_id: "test-session", pack_id: "cn.tang.core", version: "0.2.4",
    } as ActiveSession, { onStatus, onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = { disconnect: vi.fn() };
    await controller.speakWelcome("欢迎来到时空博物馆。请说进入唐代或进入宋代；单说可以不会替你选馆。");
    expect(onStatus).toHaveBeenCalledWith("欢迎语已播完，请说进入唐代或进入宋代");
    controller.pauseNarration();
    expect(stop).toHaveBeenCalled();
    controller.dispose();
    expect(play).toHaveBeenCalled();
  });

  it("未审核故事仍讲当前件固定稿，不邀请进入故事", async () => {
    const play = vi.spyOn(NarrationPlayer.prototype, "play").mockResolvedValue(true);
    const artifact = {
      id: "cn.song.artifact.qingbai-ewer", title: "青白瓷注子", museum: "宋代馆",
      time_range: { start: 1000, end: 1099 }, material: "瓷", category: "注子",
      asset_ids: [], fact_card_ids: [], story_entry_ids: [],
      presentation: { background_node_id: "cn.song.node.qingbai-ewer.01" },
    };
    const session = {
      session_id: "song-session", session_token: "local-test-token", connection_id: "local-test-connection",
      pack_id: "cn.song.core", version: "0.1.0",
      state: { revision: 3, view_revision: 3, interaction_epoch: 1, focused_entity_id: artifact.id },
      context: { session_id: "song-session", revision: 3, event_seq: 2, mode: "explore",
        focused_artifact: artifact, visible_artifacts: [artifact], story_node: null },
    } as unknown as ActiveSession;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/context")) return new Response(JSON.stringify(session.context), { status: 200 });
      if (url.includes("/content?")) return new Response(JSON.stringify({
        content_id: artifact.id, content_kind: "background", pack_id: "cn.song.core", version: "0.1.0",
        title: "青白瓷注子", artifact_id: artifact.id, paragraphs: [{
          content_id: "cn.song.node.qingbai-ewer.01", version: "0.1.0", paragraph_number: 1,
          text: "这是一件北宋青白瓷注子。",
          authorship: { node_id: "cn.song.node.qingbai-ewer.01", story_id: "cn.song.story.qingbai-ewer", fact_grade: "established" },
          presentation: null, allowed_actions: [],
        }], next_cursor: null,
      }), { status: 200 });
      return new Response(JSON.stringify(session.state), { status: 200 });
    }));
    const onStatus = vi.fn();
    const controller = new GameVoiceController(session, {
      onStatus, onTranscript: vi.fn(), onRefresh: async () => "rendered",
    });
    (controller as unknown as { voice: unknown }).voice = {
      hasControlledReply: () => true, acknowledgeRender: vi.fn(), disconnect: vi.fn(),
    };
    await (controller as unknown as { control(result: VoiceControlResult): Promise<void> }).control({
      kind: "action", receipt: {
        action: "locate_artifact", status: "committed", request_id: "song-locate", revision: 3,
      } as CommandReceipt,
    });
    expect(play).toHaveBeenCalledWith(expect.objectContaining({
      packId: "cn.song.core", version: "0.1.0",
      contentId: "cn.song.node.qingbai-ewer.01",
      text: "这是一件北宋青白瓷注子。",
    }));
    expect(play.mock.calls.some((call) => String(call[0].text).includes("想听它背后的故事"))).toBe(false);
    expect(onStatus).toHaveBeenCalledWith("展品介绍完成，可以继续参观或提问");
    controller.dispose();
  });

  it("欢迎语没有从请求发出起12秒就leave的总截止", async () => {
    vi.useFakeTimers();
    const leave = vi.spyOn(NarrationPlayer.prototype, "leave");
    let finish!: (completed: boolean) => void;
    const play = vi.spyOn(NarrationPlayer.prototype, "play")
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new GameVoiceController({
      session_id: "test-session", pack_id: "cn.tang.core", version: "0.2.4",
    } as ActiveSession, { onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = {
      disconnect: vi.fn(), beginTurn: vi.fn().mockResolvedValue(undefined), interrupt: vi.fn(),
    };
    const pending = controller.speakWelcome();
    await Promise.resolve();
    expect(controller.isWelcomeActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(leave).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
    finish(true);
    await pending;
    controller.dispose();
  });

  it("欢迎播放中用户按住打断会取消欢迎，不把失败标成已完成", async () => {
    let finish!: (completed: boolean) => void;
    vi.spyOn(NarrationPlayer.prototype, "play")
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new GameVoiceController({
      session_id: "test-session", pack_id: "cn.tang.core", version: "0.2.4",
    } as ActiveSession, { onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending" });
    (controller as unknown as { voice: unknown }).voice = {
      disconnect: vi.fn(), beginTurn: vi.fn().mockResolvedValue(undefined), interrupt: vi.fn(),
    };
    const pending = controller.speakWelcome();
    await Promise.resolve();
    expect(controller.isWelcomeActive()).toBe(true);
    controller.beginTurn("user_manual_interrupt");
    expect(controller.isWelcomeActive()).toBe(false);
    finish(false);
    await expect(pending).rejects.toThrow("手动打断");
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
      presentation: { background_node_id: "cn.tang.node.stele.01" },
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
        content_id: artifact.id, content_kind: "background", pack_id: "cn.tang.core", version: "0.2.4",
        title: "造像碑", artifact_id: artifact.id, paragraphs: [{ content_id: "cn.tang.node.stele.01", version: "0.2.4",
          paragraph_number: 1, text: "这是一段经过校订的造像碑讲解。",
          authorship: { node_id: "cn.tang.node.stele.01", story_id: "cn.tang.story.stele", fact_grade: "established" },
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
    const context = { revision: 7, mode: "explore", story_node: null, focused_artifact: null };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).endsWith("/context") ? context : { revision: 7 }), { status: 200 }),
    ));
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

  it("后端故事请求只交给导览协调器，不把enter_story当控制动作", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus: vi.fn(), onTranscript: vi.fn(), onRefresh: async () => "pending",
    });
    (controller as unknown as { guide: { handleStoryRequest: typeof handle } }).guide = { handleStoryRequest: handle };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({
      kind: "story_request",
      utterance_id: "utt-story",
      story_request: { kind: "explicit_current", utterance_id: "utt-story" },
    });
    expect(handle).toHaveBeenCalledWith(
      { kind: "explicit_current", utterance_id: "utt-story" },
      "utt-story",
    );
    controller.dispose();
  });

  it("browse_gallery committed 后发送同一request_id回执，不启动近看介绍", async () => {
    const speak = vi.spyOn(
      GameVoiceController.prototype as unknown as {
        speakFocusedArtifact(sequence: number, revision?: number, narration?: VoiceControlResult["narration"]): Promise<void>;
      },
      "speakFocusedArtifact",
    ).mockResolvedValue(undefined);
    const acknowledgeRender = vi.fn();
    const onStatus = vi.fn();
    const controller = new GameVoiceController({ session_id: "test-session" } as ActiveSession, {
      onStatus, onTranscript: vi.fn(), onRefresh: async () => "rendered",
    });
    (controller as unknown as { voice: unknown }).voice = {
      acknowledgeRender, disconnect: vi.fn(), interrupt: vi.fn(),
    };
    const handler = controller as unknown as { control(result: VoiceControlResult): Promise<void> };
    await handler.control({ kind: "action", receipt: {
      action: "browse_gallery", request_id: "browse-1", status: "committed",
    } as CommandReceipt });
    expect(acknowledgeRender).toHaveBeenCalledWith("browse-1", "rendered");
    expect(speak).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith("已转到下一组总览，仍在远观，不会开始单件介绍");
    controller.dispose();
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
