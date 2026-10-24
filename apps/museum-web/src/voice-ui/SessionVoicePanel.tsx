import { useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "../voice/PlaybackQueue";
import { VoiceClient, type VoiceCallbacks } from "../voice/VoiceClient";
import type { CaptureCallbacks } from "../voice/MicrophoneCapture";
import { VoiceEntry } from "./VoiceEntry";

const VOICE_ENDPOINT = import.meta.env.VITE_MUSEUM_VOICE_WS?.trim()
  || "ws://127.0.0.1:8782/voice/ws";

interface TranscriptLine {
  id: number;
  role: "你" | "讲解员" | "系统";
  text: string;
}

/** One explicit local voice session, scoped to the currently mounted museum session. */
export function SessionVoicePanel({ packId, version }: { packId: string; version: string }) {
  const context = useRef<AudioContext | null>(null);
  const playback = useRef<PlaybackQueue | null>(null);
  const client = useRef<VoiceClient | null>(null);
  const mounted = useRef(true);
  const [connection, setConnection] = useState("语音桥尚未连接");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const nextLine = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      client.current?.disconnect();
      client.current = null;
      playback.current?.stop();
      playback.current = null;
      void context.current?.close().catch(() => undefined);
      context.current = null;
    };
  }, []);

  async function prepareVoice() {
    const audio = context.current ?? new AudioContext();
    context.current = audio;
    await audio.resume();
    if (!playback.current) playback.current = new PlaybackQueue(audio);
    if (!client.current) {
      const callbacks: VoiceCallbacks = {
        onState(state, message) {
          if (!mounted.current) return;
          setConnection(message ?? ({
            connecting: "正在连接本机语音桥…",
            connected: "已连接本机语音桥",
            disconnected: "本机语音桥已断开",
            error: "本机语音连接失败",
          } as const)[state]);
        },
        onText(type, text) {
          const normalized = text.trim();
          if (!normalized || !mounted.current) return;
          const role: TranscriptLine["role"] = type === "stt" ? "你" : type === "tts" || type === "llm" ? "讲解员" : "系统";
          setLines((current) => [...current, { id: nextLine.current++, role, text: normalized }].slice(-6));
        },
      };
      client.current = new VoiceClient(playback.current, callbacks, VOICE_ENDPOINT);
    }
  }

  const callbacks: CaptureCallbacks = {
    onSpeechStarted() {
      void client.current?.beginTurn().catch((error: unknown) => {
        if (mounted.current) setConnection(error instanceof Error ? error.message : "语音连接失败");
      });
    },
    onSpeechEnded() { client.current?.endTurn(); },
    onFrame(frame) { client.current?.sendFrame(frame.pcm); },
    onDisconnected() {
      client.current?.disconnect();
      if (mounted.current) setConnection("麦克风已断开，本机语音连接已关闭");
    },
  };

  function stopVoice() {
    client.current?.disconnect();
    playback.current?.stop();
    void context.current?.close().catch(() => undefined);
    client.current = null;
    playback.current = null;
    context.current = null;
    setConnection("语音已暂停");
  }

  return (
    <section className="session-voice" aria-labelledby="session-voice-title">
      <div className="session-voice-heading">
        <div>
          <p className="section-kicker">当前展厅 · {packId} @ {version}</p>
          <h2 id="session-voice-title">语音讲解</h2>
        </div>
        <VoiceEntry callbacks={callbacks} beforeStart={prepareVoice} onStop={stopVoice} />
      </div>
      <p className="session-voice-status" role="status" aria-live="polite">{connection}</p>
      <p className="session-voice-note">可直接说出问题与追问。语音暂用于对话和播放，展厅动作尚未接入。</p>
      <ol className="session-voice-transcript" aria-label="本轮语音内容">
        {lines.map((line) => (
          <li key={line.id}><strong>{line.role}</strong><span>{line.text}</span></li>
        ))}
      </ol>
    </section>
  );
}
