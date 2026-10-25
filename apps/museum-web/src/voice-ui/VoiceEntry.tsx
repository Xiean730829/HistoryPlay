import { useEffect, useRef, useState } from "react";
import { MicrophoneCapture } from "../voice/MicrophoneCapture";
import type { CaptureCallbacks } from "../voice/MicrophoneCapture";

/** Explicit microphone permission entry; game orchestration is injected by MuseumShell. */
export function VoiceEntry({ callbacks, beforeStart, afterConnect, onStop }: {
  callbacks: CaptureCallbacks;
  /** Called from the explicit user gesture: unlock the shared output context here. */
  beforeStart?: () => Promise<void>;
  /** Speak an app welcome after transport setup, before opening the microphone. */
  afterConnect?: () => Promise<void>;
  /** Close the voice transport and release AudioFocus on pause/unmount. */
  onStop?: () => void;
}) {
  const capture = useRef<MicrophoneCapture | null>(null);
  const [status, setStatus] = useState("语音未开启");
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const alive = useRef(true);
  const stopLatest = useRef(onStop);
  stopLatest.current = onStop;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; capture.current?.stop(); stopLatest.current?.(); };
  }, []);

  async function toggle() {
    if (active) {
      capture.current?.stop();
      onStop?.();
      setActive(false);
      setStatus("语音已暂停");
      return;
    }
    setOpening(true);
    setStatus("请在浏览器提示中允许麦克风");
    const microphone = new MicrophoneCapture({ ...callbacks, onDisconnected() {
      callbacks.onDisconnected();
      if (alive.current) { setActive(false); setStatus("麦克风已断开，请重新开启"); }
    } });
    capture.current = microphone;
    try {
      // Call getUserMedia from the click before any network waits. If permission
      // is requested only after bridge setup and the greeting, browsers may
      // delay or suppress the prompt.
      await microphone.requestPermission();
      if (!alive.current) return;
      setStatus("麦克风权限已取得，正在连接讲解员");
      await beforeStart?.();
      if (!alive.current) return;
      await afterConnect?.();
      if (!alive.current) return;
      setStatus("请允许使用麦克风，以便回答讲解员");
      const settings = await microphone.start();
      if (!alive.current) return;
      setActive(true);
      setStatus(settings.echoCancellation === true ? "麦克风已开启" : "麦克风已开启，回声抑制未确认");
    } catch (error) {
      microphone.stop();
      onStop?.();
      let message = error instanceof Error ? error.message : "无法开启语音";
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
          message = "麦克风权限未开启。请在浏览器地址栏的网站权限中允许麦克风，再点一次开启语音。";
        } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          message = "没有检测到可用麦克风，请连接麦克风后重试。";
        } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
          message = "麦克风正在被其他程序占用，请关闭占用麦克风的程序后重试。";
        }
      } else if (error instanceof TypeError && /fetch/i.test(error.message)) {
        message = "无法连接本机语音服务。请确认展厅服务已启动，再刷新页面重试。";
      } else if (message === "本机语音连接未完成") {
        message = "语音桥没有收到讲解员就绪信号，请检查本机语音服务后重试。";
      }
      if (alive.current) setStatus(message);
    } finally {
      if (alive.current) setOpening(false);
    }
  }

  return <div className="voice-entry">
    <button type="button" onClick={() => void toggle()} disabled={opening} aria-pressed={active}>
      {opening ? "正在开启语音…" : active ? "暂停语音" : "开启语音并允许麦克风"}
    </button>
    <span role="status" aria-live="polite">{status}</span>
  </div>;
}
