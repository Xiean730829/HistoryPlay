import { describe, expect, it, vi } from "vitest";
import { PlaybackQueue } from "./PlaybackQueue";

function fixture() {
  const sources: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = [];
  const context = {
    currentTime: 0, destination: {},
    createBuffer: (_channels: number, count: number, rate: number) => ({
      duration: count / rate, getChannelData: () => new Float32Array(count),
    }),
    createBufferSource: () => {
      const source = { stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), start: vi.fn(), onended: null };
      sources.push(source);
      return source;
    },
  } as unknown as AudioContext;
  return { queue: new PlaybackQueue(context), sources };
}

describe("音频播放队列", () => {
  it("停止先清空全部节点并拒绝所有旧代音频", () => {
    const { queue, sources } = fixture();
    const old = queue.epoch;
    const completed = vi.fn();
    expect(queue.enqueue(new Int16Array(320), 16000, old)).toBe(true);
    queue.onDrained(old, completed);
    const current = queue.stop();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(queue.enqueue(new Int16Array(320), 16000, old)).toBe(false);
    expect(queue.enqueue(new Int16Array(320), 16000, current)).toBe(true);
  });
  it("真实节点排空才通知完成，云端发送结束不触发完成", () => {
    const { queue, sources } = fixture();
    queue.enqueue(new Int16Array(320), 16000, queue.epoch);
    queue.enqueue(new Int16Array(320), 16000, queue.epoch);
    const completed = vi.fn();
    queue.onDrained(queue.epoch, completed);
    sources[0].onended?.();
    expect(completed).not.toHaveBeenCalled();
    sources[1].onended?.();
    expect(completed).toHaveBeenCalledOnce();
  });
});
