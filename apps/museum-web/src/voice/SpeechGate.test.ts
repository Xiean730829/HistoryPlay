import { describe, expect, it } from "vitest";
import { SpeechGate } from "./SpeechGate";

function pushMany(gate: SpeechGate, rms: number | ((index: number) => number), frames: number) {
  const events: string[] = [];
  for (let index = 0; index < frames; index += 1) {
    const value = typeof rms === "function" ? rms(index) : rms;
    const decision = gate.push({ rms: value });
    if (decision.event) events.push(decision.event);
  }
  return events;
}

function speechBurst(index: number): number {
  const cycle = index % 8;
  return cycle < 3 ? 0.012 : 0.09;
}

describe("SpeechGate", () => {
  it("确认后像按住说话一样保留稳定音节和800ms词间停顿，不切掉文物名称", () => {
    const gate = new SpeechGate();
    expect(pushMany(gate, speechBurst, 20)).toContain("confirmed");
    expect(pushMany(gate, 0.04, 90)).not.toContain("ended");
    expect(pushMany(gate, 0.0004, 40)).not.toContain("ended");
    expect(pushMany(gate, speechBurst, 20)).not.toContain("ended");
    expect(pushMany(gate, 0.0004, 80)).toContain("ended");
  });
  it("20秒恒定高于旧阈值的噪声不会确认人声，也不会让收音常驻", () => {
    const gate = new SpeechGate();
    const events = pushMany(gate, 0.01, 1000);
    expect(events).not.toContain("confirmed");
    expect(events).not.toContain("ended");
    expect(gate.snapshot().reason === "idle" || events.includes("misfire") || events.length === 0).toBe(true);
  });

  it("有调制的短词可以确认，说完后在风扇底噪上也能结束", () => {
    const gate = new SpeechGate();
    pushMany(gate, 0.01, 80);
    const during = pushMany(gate, speechBurst, 18);
    expect(during).toContain("confirmed");
    const after = pushMany(gate, 0.01, 80);
    expect(after).toContain("ended");
  });

  it("键盘式短脉冲只记误触发，不确认人声", () => {
    const gate = new SpeechGate();
    const events = [
      ...pushMany(gate, 0.0004, 10),
      ...pushMany(gate, 0.2, 2),
      ...pushMany(gate, 0.0004, 20),
    ];
    expect(events).not.toContain("confirmed");
    expect(events.includes("misfire") || events.length === 0 || events.includes("candidate")).toBe(true);
    expect(gate.push({ rms: Number.NaN }).event).toBeNull();
  });

  it("开麦后立刻说话不会把第一句吸进底噪", () => {
    const gate = new SpeechGate();
    const events = pushMany(gate, speechBurst, 20);
    expect(events).toContain("confirmed");
    expect(gate.snapshot().noiseFloor).toBeLessThan(0.02);
  });

  it("超过时长上限会安全收口，而不是无限挂住", () => {
    const gate = new SpeechGate();
    const events = pushMany(gate, speechBurst, 1600);
    expect(events).toContain("confirmed");
    expect(events).toContain("ended");
    expect(events.filter((item) => item === "ended")).toHaveLength(1);
  });

  it("持续调制噪声在时长上限后不会立刻再确认", () => {
    const gate = new SpeechGate();
    const first = pushMany(gate, speechBurst, 1520);
    expect(first.filter((item) => item === "confirmed")).toHaveLength(1);
    expect(first).toContain("ended");
    const again = pushMany(gate, speechBurst, 80);
    expect(again).not.toContain("confirmed");
    expect(again).not.toContain("ended");
    expect(gate.snapshot().reason === "hold_off" || gate.snapshot().reason === "rearmed").toBe(true);
  });

  it("说完静音结束后立刻再说话仍可确认", () => {
    const gate = new SpeechGate();
    pushMany(gate, 0.01, 80);
    expect(pushMany(gate, speechBurst, 18)).toContain("confirmed");
    expect(pushMany(gate, 0.01, 80)).toContain("ended");
    const second = pushMany(gate, speechBurst, 30);
    expect(second).toContain("confirmed");
  });

  it("采集停帧时 forceEnd 会收口当前确认", () => {
    const gate = new SpeechGate();
    pushMany(gate, speechBurst, 20);
    expect(gate.isConfirmed()).toBe(true);
    const ended = gate.forceEnd("capture_stalled");
    expect(ended?.event).toBe("ended");
    expect(ended?.stats.reason).toBe("capture_stalled");
    expect(gate.isConfirmed()).toBe(false);
  });

  it("欢迎结束后先安静再武装，回声尾部不会立刻确认", () => {
    const gate = new SpeechGate();
    gate.armQuietRearm();
    expect(pushMany(gate, speechBurst, 20)).not.toContain("confirmed");
    pushMany(gate, 0.0004, 30);
    expect(pushMany(gate, speechBurst, 30)).toContain("confirmed");
  });
});
