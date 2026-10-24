import { useEffect, useRef, useState } from "react";
import { MicrophoneCapture } from "../voice/MicrophoneCapture";
import type { CaptureCallbacks } from "../voice/MicrophoneCapture";

/** Explicit microphone permission entry; game orchestration is injected by MuseumShell. */
export function VoiceEntry({ callbacks, beforeStart, onStop }: {
  callbacks: CaptureCallbacks;
  /** Called from the explicit user gesture: unlock the shared output context here. */
  beforeStart?: () => Promise<void>;
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
    setStatus("正在请求麦克风权限");
    const microphone = new MicrophoneCapture({ ...callbacks, onDisconnected() {
      callbacks.onDisconnected();
      if (alive.current) { setActive(false); setStatus("麦克风已断开，请重新开启"); }
    } });
    capture.current = microphone;
    try {
      await beforeStart?.();
      if (!alive.current) return;
      const settings = await microphone.start();
      if (!alive.current) return;
      setActive(true);
      setStatus(settings.echoCancellation === true ? "麦克风已开启" : "麦克风已开启，回声抑制未确认");
    } catch (error) {
      if (alive.current) setStatus(error instanceof Error ? error.message : "无法开启麦克风");
    } finally {
      if (alive.current) setOpening(false);
    }
  }

  return <div className="voice-entry">
    <button type="button" onClick={() => void toggle()} disabled={opening} aria-pressed={active}>
      {active ? "暂停语音" : "开启语音"}
    </button>
    <span role="status" aria-live="polite">{status}</span>
  </div>;
}
