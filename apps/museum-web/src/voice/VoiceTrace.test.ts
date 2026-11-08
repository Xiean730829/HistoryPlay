import { describe, expect, it } from "vitest";
import { VoiceTraceLog } from "./VoiceTrace";

describe("VoiceTraceLog", () => {
  it("用同一个utterance_id串起脱敏阶段，不记录音频或密钥", () => {
    const log = new VoiceTraceLog();
    log.setConnected(false, "backend_unavailable");
    expect(log.summaryLine()).toContain("未连接");
    log.setConnected(true, "bridge_ready");
    const id = log.beginUtterance();
    log.record("capture", { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 });
    log.record("gate", { event: "confirmed", rms: 0.04 });
    log.record("stt", { text: "我要去看牛", empty: false });
    log.record("action", { action: "locate_artifact", status: "committed", token: "secret-token" });
    const snap = log.snapshot();
    expect(snap?.utteranceId).toBe(id);
    expect(snap?.stages.action).not.toHaveProperty("token");
    expect(snap?.stages.stt?.text).toBe("我要去看牛");
    expect(log.summaryLine()).toContain("action");
  });

  it("记录原问答和固定稿阶段，不写入音频或密钥", () => {
    const log = new VoiceTraceLog();
    log.setConnected(true, "bridge_ready");
    log.beginUtterance();
    log.record("answer", { phase: "awaiting_answer", pending: true, token: "secret" });
    log.record("fixed", { queued: true, request_id: "fixed-1", chunk_index: 0, audio: "pcm-bytes" });
    const snap = log.snapshot();
    expect(snap?.stages.answer?.pending).toBe(true);
    expect(snap?.stages.answer).not.toHaveProperty("token");
    expect(snap?.stages.fixed).not.toHaveProperty("audio");
    expect(snap?.stages.fixed?.chunk_index).toBe(0);
  });

  it("新轮次会保留上一轮，并记录后继ID", () => {
    const log = new VoiceTraceLog();
    log.setConnected(true, "bridge_ready");
    const first = log.beginUtterance();
    log.record("gate", { event: "confirmed", reason: "manual_press" });
    log.record("uplink", { start: true, pendingFrames: 12 });
    const second = log.beginUtterance();
    log.record("gate", { event: "confirmed", reason: "confirmed_speech" });
    const history = log.history();
    expect(history).toHaveLength(2);
    expect(history[0].utteranceId).toBe(first);
    expect(history[1].utteranceId).toBe(second);
    expect(history[0].stages.uplink?.successorId).toBe(second);
    expect(history[0].stages.uplink?.cancel).toBe(true);
    expect(log.snapshot()?.utteranceId).toBe(second);
  });

  it("上一轮已stop、正在等回答时被新轮次打断，记录回答被替换", () => {
    const log = new VoiceTraceLog();
    log.setConnected(true, "bridge_ready");
    const first = log.beginUtterance();
    log.record("uplink", { stop: true, stopSent: true });
    log.record("answer", { phase: "awaiting_answer", pending: true });
    const second = log.beginUtterance();
    const previous = log.history()[0];
    expect(previous.utteranceId).toBe(first);
    expect(previous.stages.uplink?.successorId).toBe(second);
    expect(previous.stages.uplink?.reason).toBe("answer_superseded");
    expect(previous.stages.answer?.cancelled).toBe(true);
    expect(previous.stages.answer?.reason).toBe("answer_superseded");
  });
});
