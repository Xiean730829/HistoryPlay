import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneCapture } from "./MicrophoneCapture";

afterEach(() => vi.unstubAllGlobals());

function fixture(getUserMedia = vi.fn()) {
  const close = vi.fn().mockResolvedValue(undefined);
  const callbacks = {
    onSpeechStarted: vi.fn(), onSpeechEnded: vi.fn(), onFrame: vi.fn(), onDisconnected: vi.fn(),
  };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", class { resume = vi.fn().mockResolvedValue(undefined); close = close; });
  return { capture: new MicrophoneCapture(callbacks), close, callbacks };
}

describe("麦克风生命周期", () => {
  it("拒绝权限时关闭已创建音频上下文，不伪造已连接", async () => {
    const media = vi.fn().mockRejectedValue(new DOMException("权限被拒绝", "NotAllowedError"));
    const { capture, close, callbacks } = fixture(media);
    await expect(capture.start()).rejects.toThrow("权限被拒绝");
    expect(close).toHaveBeenCalledOnce();
    expect(callbacks.onFrame).not.toHaveBeenCalled();
  });
  it("等待权限期间停止，随后获准的设备也会关闭，不遗留录音", async () => {
    let resolve!: (value: unknown) => void;
    const media = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const { capture } = fixture(media);
    const opening = capture.start();
    await Promise.resolve();
    capture.stop();
    const stop = vi.fn();
    resolve({ getTracks: () => [{ stop }] });
    await expect(opening).rejects.toThrow("已取消");
    expect(stop).toHaveBeenCalledOnce();
  });
});
