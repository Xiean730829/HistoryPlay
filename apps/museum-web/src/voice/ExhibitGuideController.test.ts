import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../application/museumApi";
import { ExhibitGuideController, isShortStoryConsent, isStoryDecline } from "./ExhibitGuideController";
import type { StoryRequest } from "./VoiceClient";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function artifact(id: string, storyId = `${id}.story`) {
  return { id, story_entry_ids: [storyId] };
}

function sessionFor(id: string, mode = "explore"): ActiveSession {
  return {
    session_id: "s1", session_token: "t", connection_id: "c", control_ticket: "k",
    pack_id: "cn.tang.core", version: "0.3.2",
    state: { revision: 7, view_revision: 1, interaction_epoch: 1, focused_entity_id: id, mode },
    context: {
      session_id: "s1", revision: 7, event_seq: 1, mode,
      focused_artifact: artifact(id), visible_artifacts: [artifact(id)], story_node: null,
    },
  } as unknown as ActiveSession;
}

function stubApi(sessions: ActiveSession[], receipts: Array<{ status: string; action?: string; request_id?: string; revision?: number; reason?: string }> = []) {
  let sessionIndex = 0;
  let receiptIndex = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.endsWith("/commands")) {
      const receipt = receipts[receiptIndex] ?? { status: "committed", action: "enter_story", request_id: "enter-1", revision: 8 };
      receiptIndex += 1;
      return new Response(JSON.stringify({
        schema_version: "1", receipt_id: "receipt-1", request_id: receipt.request_id ?? "enter-1",
        session_id: "s1", status: receipt.status, action: receipt.action ?? "enter_story",
        revision: receipt.revision ?? 8, interaction_epoch: 1, reason: receipt.reason ?? null,
      }), { status: 200 });
    }
    const current = sessions[Math.min(sessionIndex, sessions.length - 1)];
    if (url.endsWith("/context")) {
      sessionIndex += 1;
      return new Response(JSON.stringify(current.context), { status: 200 });
    }
    return new Response(JSON.stringify(current.state), { status: 200 });
  }));
}

function controller(session: ActiveSession) {
  const hooks = {
    onStatus: vi.fn(),
    speakIntro: vi.fn().mockResolvedValue(undefined),
    presentInspection: vi.fn().mockResolvedValue("rendered" as const),
    onStoryOpened: vi.fn().mockResolvedValue(undefined),
    currentSequence: () => 0,
    disposed: () => false,
  };
  return { guide: new ExhibitGuideController(session, hooks), hooks };
}

describe("ExhibitGuideController", () => {
  it.each(["我要听文物的故事", "我想听这件文物的故事", "我要听这个文物背后的故事", "我想听它背后的故事", "请讲这件展品的故事"])("%s 使用当前展品的故事", async (text) => {
    const session = sessionFor("cn.song.artifact.qingbai-ewer");
    session.pack_id = "cn.song.core";
    stubApi([session, session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript(text, "current-story")).toBe(true);
    expect(hooks.onStoryOpened).toHaveBeenCalledOnce();
  });

  it.each(["我要听铜钱的故事", "我想听青白瓷注子的故事", "给我讲讲牛故事"])("%s 不误用当前展品，应交给指定名称解析", async (text) => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript(text, "named-story")).toBe(false);
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
  });

  it("没有焦点时说明要先选择展品", async () => {
    const session = sessionFor("cn.tang.artifact.kaiyuan-coin");
    session.context.focused_artifact = null;
    stubApi([session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript("讲故事")).toBe(true);
    expect(hooks.onStatus).toHaveBeenCalledWith("请先选择一件文物，再听它的故事");
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
  });
  it.each(["可以", "好啊", "那就听听"])("把短同意 %s 识别为邀请确认", (text) => {
    expect(isShortStoryConsent(text)).toBe(true);
  });

  it.each(["先不听", "不想听故事", "不要听故事", "不要讲故事", "等等"])("把 %s 识别为拒绝故事", (text) => {
    expect(isStoryDecline(text)).toBe(true);
  });

  it("邀请未可听见时短同意不能进入故事", async () => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptConsentFromTranscript("可以")).toBe(false);
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
  });

  it("未审核故事明确说明未开放，不假装已进入", async () => {
    const session = sessionFor("cn.song.artifact.qingbai-ewer");
    session.pack_id = "cn.song.core";
    session.version = "0.1.0";
    session.context.focused_artifact = { id: "cn.song.artifact.qingbai-ewer", story_entry_ids: [] } as unknown as typeof session.context.focused_artifact;
    stubApi([session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript("讲故事")).toBe(true);
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
    expect(hooks.onStatus).toHaveBeenCalledWith("当前文物还没有开放故事");
  });

  it("邀请可听见后短同意只进入一次，重复utterance_id不再提交", async () => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session, session], [{ status: "committed", action: "enter_story" }]);
    const { guide, hooks } = controller(session);
    guide.noteInspection("cn.tang.artifact.gilt-bronze-bull", 7, "voice");
    guide.markOfferAudible("cn.tang.artifact.gilt-bronze-bull", "cn.tang.artifact.gilt-bronze-bull.story", 7);
    expect(await guide.acceptConsentFromTranscript("可以", "utt-1")).toBe(true);
    expect(await guide.acceptConsentFromTranscript("可以", "utt-1")).toBe(true);
    expect(hooks.onStoryOpened).toHaveBeenCalledOnce();
  });

  it("噪声或空字幕不消费仍有效的邀请", async () => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session]);
    const { guide } = controller(session);
    guide.noteInspection("cn.tang.artifact.gilt-bronze-bull", 7, "click");
    guide.markOfferAudible("cn.tang.artifact.gilt-bronze-bull", "cn.tang.artifact.gilt-bronze-bull.story", 7);
    expect(await guide.acceptConsentFromTranscript("")).toBe(false);
    expect(await guide.acceptConsentFromTranscript("风扇声")).toBe(false);
    expect(guide.currentOffer()?.consumed).toBeFalsy();
  });

  it("指定另一件文物的故事请求先定位再进入，不沿用当前物故事", async () => {
    const bull = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    const coin = sessionFor("cn.tang.artifact.kaiyuan-coin");
    stubApi([bull, coin, coin], [
      { status: "committed", action: "locate_artifact", request_id: "loc-1", revision: 8 },
      { status: "committed", action: "enter_story", request_id: "enter-2", revision: 9 },
    ]);
    const { guide, hooks } = controller(bull);
    const request: StoryRequest = {
      kind: "explicit_named",
      query: "铜钱",
      artifact_id: "cn.tang.artifact.kaiyuan-coin",
      candidates: 1,
    };
    await guide.handleStoryRequest(request, "utt-named");
    expect(hooks.presentInspection).toHaveBeenCalledOnce();
    expect(hooks.onStoryOpened).toHaveBeenCalledOnce();
  });

  it("明确拒绝后短同意不能打开故事", async () => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session]);
    const { guide, hooks } = controller(session);
    guide.noteInspection("cn.tang.artifact.gilt-bronze-bull", 7, "voice");
    guide.markOfferAudible("cn.tang.artifact.gilt-bronze-bull", "cn.tang.artifact.gilt-bronze-bull.story", 7);
    await guide.handleStoryRequest({ kind: "decline" }, "utt-no");
    expect(await guide.acceptConsentFromTranscript("可以")).toBe(false);
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
  });

  it.each(["看故事", "背后的故事", "带我看看背后的故事", "带我听一听故事", "带我听一听背后的故事", "听故事", "讲故事", "看看故事"])("把 %s 当作当前文物故事入口", async (text) => {
    const session = sessionFor("cn.tang.artifact.kaiyuan-coin");
    stubApi([session, session], [{ status: "committed", action: "enter_story", request_id: "enter-story", revision: 8 }]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript(text, "utt-story")).toBe(true);
    expect(hooks.onStoryOpened).toHaveBeenCalledOnce();
  });

  it("指定另一件文物的故事不占用当前文物故事入口", async () => {
    const session = sessionFor("cn.tang.artifact.gilt-bronze-bull");
    stubApi([session]);
    const { guide, hooks } = controller(session);
    expect(await guide.acceptExplicitStoryFromTranscript("铜钱的故事")).toBe(false);
    expect(await guide.acceptExplicitStoryFromTranscript("讲讲铜钱的故事")).toBe(false);
    expect(hooks.onStoryOpened).not.toHaveBeenCalled();
  });
});
