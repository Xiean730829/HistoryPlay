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

  it("暂停后新建采集对象仍能恢复手动按住说话", () => {
    const first = fixture();
    first.capture.setMode("manual");
    first.capture.setManualListening(true);
    first.capture.setManualListening(false);
    expect(first.callbacks.onSpeechStarted).toHaveBeenCalledOnce();
    expect(first.callbacks.onSpeechEnded).toHaveBeenCalledOnce();
    first.capture.stop();

    const second = fixture();
    expect(second.capture.getMode()).toBe("gate");
    second.capture.setMode("manual");
    second.capture.setManualListening(true);
    second.capture.setManualListening(false);
    expect(second.callbacks.onSpeechStarted).toHaveBeenCalledOnce();
    expect(second.callbacks.onSpeechEnded).toHaveBeenCalledOnce();
  });

  it("切到手动模式会结束尚未收口的自动输入", () => {
    const { capture, callbacks } = fixture();
    capture.setMode("manual");
    capture.setManualListening(true);
    expect(callbacks.onSpeechStarted).toHaveBeenCalledOnce();
    capture.setMode("gate");
    expect(callbacks.onSpeechEnded).toHaveBeenCalledOnce();
    expect(capture.getMode()).toBe("gate");
  });

  it("欢迎保护期间自动门控不发新轮次，按住仍可打断", () => {
    const { capture, callbacks } = fixture();
    capture.setWelcomeHoldOnly(true);
    expect(capture.isWelcomeHoldOnly()).toBe(true);
    capture.setHoldListening(true);
    expect(callbacks.onSpeechStarted).toHaveBeenCalledOnce();
    capture.setHoldListening(false);
    expect(callbacks.onSpeechEnded).toHaveBeenCalledOnce();
  });

  it("欢迎结束后恢复原先手动模式，不擅自改回自动", () => {
    const { capture } = fixture();
    capture.setMode("manual");
    capture.setWelcomeHoldOnly(true);
    capture.rearmAfterWelcome();
    expect(capture.getMode()).toBe("manual");
    expect(capture.isWelcomeHoldOnly()).toBe(false);
  });
});
