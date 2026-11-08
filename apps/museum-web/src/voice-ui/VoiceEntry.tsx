import { useEffect, useRef, useState } from "react";
import { MicrophoneCapture } from "../voice/MicrophoneCapture";
import type { CaptureCallbacks, CaptureSettings } from "../voice/MicrophoneCapture";
import { voiceTrace } from "../voice/VoiceTrace";
import { connectAfterHandoff } from "./handoffRetry";

function constraintLabel(value: boolean | null | undefined): string {
  if (value === true) return "开";
  if (value === false) return "关";
  return "未知";
}

/** Explicit microphone permission entry; game orchestration is injected by MuseumShell. */
export function VoiceEntry({ callbacks, beforeStart, afterConnect, onStop, onSettings,
  autoStart = false, initialMode = "gate", onActiveChange }: {
  callbacks: CaptureCallbacks;
  /** Called from the explicit user gesture: unlock the shared output context here. */
  beforeStart?: () => Promise<void>;
  /** Optional work after the microphone is already open. Must not block listening. */
  afterConnect?: (capture: {
    setWelcomeHoldOnly(enabled: boolean): void;
    rearmAfterWelcome(): void;
    getLifecycle(): number;
    isStopped(): boolean;
    getMode(): "gate" | "manual";
  }) => Promise<void>;
  /** Close the voice transport and release AudioFocus on pause/unmount. */
  onStop?: () => void;
  onSettings?: (settings: CaptureSettings | null, mode: "gate" | "manual") => void;
  /** Only used to continue a microphone session the visitor already enabled. */
  autoStart?: boolean;
  initialMode?: "gate" | "manual";
  onActiveChange?: (active: boolean) => void;
}) {
  const capture = useRef<MicrophoneCapture | null>(null);
  const [status, setStatus] = useState("语音未开启");
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [manual, setManual] = useState(initialMode === "manual");
  const [holding, setHolding] = useState(false);
  const [welcomeHold, setWelcomeHold] = useState(false);
  const [captureMode, setCaptureMode] = useState<"gate" | "manual">("gate");
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLine, setDiagLine] = useState(voiceTrace.summaryLine());
  const [diagHistory, setDiagHistory] = useState(voiceTrace.history());
  const alive = useRef(true);
  const manualRef = useRef(initialMode === "manual");
  const starting = useRef(false);
  const autoRequested = useRef(false);
  const toggleLatest = useRef<() => Promise<void>>(async () => undefined);
  const stopLatest = useRef(onStop);
  stopLatest.current = onStop;
  manualRef.current = manual;
  useEffect(() => {
    alive.current = true;
    const unsubscribe = voiceTrace.subscribe(() => {
      setDiagLine(voiceTrace.summaryLine());
      setDiagHistory(voiceTrace.history());
    });
    return () => { alive.current = false; capture.current?.stop(); stopLatest.current?.(); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!autoStart || autoRequested.current) return;
    // Deferring one task lets StrictMode's initial cleanup complete before the
    // new panel takes ownership of the microphone and device connection.
    const handle = setTimeout(() => {
      if (!alive.current || autoRequested.current) return;
      autoRequested.current = true;
      void toggleLatest.current();
    }, 0);
    return () => clearTimeout(handle);
  }, [autoStart]);

  function applySettings(next: CaptureSettings | null, mode: "gate" | "manual") {
    setSettings(next);
    setCaptureMode(mode);
    onSettings?.(next, mode);
  }

  async function toggle() {
    if (starting.current) return;
    if (active) {
      capture.current?.stop();
      onStop?.();
      setActive(false);
      if (alive.current) onActiveChange?.(false);
      setHolding(false);
      setWelcomeHold(false);
      setStatus("语音已暂停");
      applySettings(null, captureMode);
      return;
    }
    starting.current = true;
    setOpening(true);
    setStatus("请在浏览器提示中允许麦克风");
    const microphone = new MicrophoneCapture({ ...callbacks, onDisconnected() {
      callbacks.onDisconnected();
      if (alive.current) {
        onActiveChange?.(false);
        setActive(false); setHolding(false); setWelcomeHold(false); setStatus("麦克风已断开，请重新开启");
      }
    } });
    if (manualRef.current) microphone.setMode("manual");
    capture.current = microphone;
    try {
      // Call getUserMedia from the click before any network waits. If permission
      // is requested only after bridge setup, browsers may delay or suppress the prompt.
      await microphone.requestPermission();
      if (!alive.current) return;
      setStatus("麦克风权限已取得，正在连接讲解员");
      await connectAfterHandoff(async () => { await beforeStart?.(); }, autoStart, () => alive.current);
      if (!alive.current) return;
      if (afterConnect) {
        microphone.setWelcomeHoldOnly(true);
        setWelcomeHold(true);
      }
      setStatus("正在打开麦克风");
      const actual = await microphone.start();
      if (!alive.current) return;
      if (manualRef.current && microphone.getMode() !== "manual") microphone.setMode("manual");
      setActive(true);
      onActiveChange?.(true);
      applySettings(actual, microphone.getMode());
      const ns = constraintLabel(actual.noiseSuppression);
      const aec = constraintLabel(actual.echoCancellation);
      setStatus(microphone.getMode() === "manual"
        ? "人声门控未使用，请按住说话，松开后发送"
        : aec === "开" ? `麦克风已开启（回声抑制开，降噪${ns}）` : "麦克风已开启，回声抑制未确认");
      const captureApi = {
        setWelcomeHoldOnly(enabled: boolean) {
          if (capture.current !== microphone || microphone.isStopped()) return;
          microphone.setWelcomeHoldOnly(enabled);
          if (alive.current) setWelcomeHold(enabled);
        },
        rearmAfterWelcome() {
          if (capture.current !== microphone || microphone.isStopped()) return;
          const preferred = manualRef.current ? "manual" : "gate";
          if (microphone.getMode() !== preferred) microphone.setMode(preferred);
          microphone.rearmAfterWelcome();
          if (alive.current) {
            setWelcomeHold(false);
            applySettings(microphone.getSettings(), microphone.getMode());
          }
        },
        getLifecycle: () => microphone.getLifecycle(),
        isStopped: () => microphone.isStopped() || capture.current !== microphone,
        getMode: () => microphone.getMode(),
      };
      void Promise.resolve(afterConnect?.(captureApi)).catch(() => undefined);
    } catch (error) {
      microphone.stop();
      onStop?.();
      if (alive.current) onActiveChange?.(false);
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
      starting.current = false;
      if (alive.current) setOpening(false);
    }
  }
  toggleLatest.current = toggle;

  function enableManual() {
    const microphone = capture.current;
    if (!microphone || !active) return;
    microphone.setMode("manual");
    setManual(true);
    applySettings(microphone.getSettings(), "manual");
    setStatus("人声门控未使用，请按住说话，松开后发送");
  }

  function hold(activeHold: boolean) {
    const microphone = capture.current;
    if (!active || !microphone) {
      if (holding) setHolding(false);
      return;
    }
    const canStartHold = microphone.getMode() === "manual" || welcomeHold || microphone.isWelcomeHoldOnly();
    if (activeHold && !canStartHold) {
      if (holding) setHolding(false);
      return;
    }
    setHolding(activeHold);
    microphone.setHoldListening(activeHold);
    setStatus(activeHold ? "正在按住说话" : "已松开，正在提交这一句");
  }

  return <div className="voice-entry">
    <button type="button" onClick={() => void toggle()} disabled={opening} aria-pressed={active}>
      {opening ? "正在开启语音…" : active ? "暂停语音" : "开启语音并允许麦克风"}
    </button>
    {active && captureMode !== "manual" && !welcomeHold && <button type="button" className="button-quiet" onClick={enableManual}>改用按住说话</button>}
    {active && (captureMode === "manual" || welcomeHold) && <button type="button"
      aria-pressed={holding}
      onPointerDown={(event) => { event.preventDefault(); hold(true); }}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      onBlur={() => hold(false)}
    >{holding ? "松开结束" : welcomeHold ? "按住打断并说话" : "按住说话"}</button>}
    <span role="status" aria-live="polite">{status}</span>
    <details className="voice-diag" open={diagOpen} onToggle={(event) => setDiagOpen((event.target as HTMLDetailsElement).open)}>
      <summary>语音诊断（默认收起）</summary>
      <p>{diagLine}</p>
      <p>AEC {constraintLabel(settings?.echoCancellation)} · NS {constraintLabel(settings?.noiseSuppression)} · AGC {constraintLabel(settings?.autoGainControl)} · {settings?.sampleRate ?? "未知"} Hz · 采集 {active ? captureMode : "未开"}</p>
      {diagHistory.length > 0 && <pre>{JSON.stringify(diagHistory.map((item) => ({
        id: item.utteranceId,
        stage: item.currentStage,
        connected: item.connected,
        stages: item.stages,
      })), null, 0)}</pre>}
    </details>
  </div>;
}
