import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSpeechAdapter } from "./BrowserSpeechAdapter";

afterEach(() => vi.unstubAllGlobals());

describe("浏览器固定正文适配", () => {
  it("逐字传入准备的正文，只有onend后Promise才完成", async () => {
    let spoken!: SpeechSynthesisUtterance;
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      constructor(public text: string) {}
    });
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [], cancel: vi.fn(), speak: (utterance: SpeechSynthesisUtterance) => { spoken = utterance; },
    });
    const controller = new AbortController();
    const started = vi.fn();
    const finished = vi.fn();
    const playing = new BrowserSpeechAdapter().play({
      packId: "tang", version: "0.2.0", contentId: "node", text: "这是准备好的原文。",
    }, controller.signal, started).then(finished);
    expect(spoken.text).toBe("这是准备好的原文。");
    expect(finished).not.toHaveBeenCalled();
    spoken.onstart?.(new Event("start") as SpeechSynthesisEvent);
    expect(started).toHaveBeenCalledOnce();
    spoken.onend?.(new Event("end") as SpeechSynthesisEvent);
    await playing;
    expect(finished).toHaveBeenCalledOnce();
  });
  it("中断取消语音合成并拒绝完成，缺API时诚实失败", async () => {
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { getVoices: () => [], cancel, speak: vi.fn() });
    const controller = new AbortController();
    const playing = new BrowserSpeechAdapter().play({
      packId: "tang", version: "0.2.0", contentId: "node", text: "原文",
    }, controller.signal, vi.fn());
    controller.abort();
    await expect(playing).rejects.toThrow("已中断");
    expect(cancel).toHaveBeenCalledOnce();
    vi.stubGlobal("speechSynthesis", undefined);
    await expect(new BrowserSpeechAdapter().play({
      packId: "tang", version: "0.2.0", contentId: "node", text: "原文",
    }, new AbortController().signal, vi.fn())).rejects.toThrow("不支持");
  });
});
