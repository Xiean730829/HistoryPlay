import { describe, expect, it } from "vitest";
import { VadController } from "./VadController";

describe("本地VAD", () => {
  it("连续120ms才确认说话，播放期间不改变门槛", () => {
    const vad = new VadController();
    for (let i = 0; i < 5; i++) expect(vad.push(0.01)).toBeNull();
    expect(vad.push(0.01)).toBe("speech_started");
    for (let i = 0; i < 32; i++) expect(vad.push(0)).toBeNull();
    expect(vad.push(0)).toBe("speech_ended");
    for (let i = 0; i < 5; i++) expect(vad.push(0.01)).toBeNull();
    expect(vad.push(0.01)).toBe("speech_started");
  });
  it("噪声峰不累计为连续语音，reset不遗留旧采集状态", () => {
    const vad = new VadController();
    for (let i = 0; i < 20; i++) { expect(vad.push(0.02)).toBeNull(); vad.push(0); }
    for (let i = 0; i < 5; i++) vad.push(0.02);
    vad.reset();
    expect(vad.push(0.02)).toBeNull();
    expect(vad.push(Number.NaN)).toBeNull();
  });
});
