import { AudioFocus } from "./AudioFocus";
import { BrowserSpeechAdapter } from "./BrowserSpeechAdapter";
import { NarrationPlayer } from "./NarrationPlayer";
import type { NarrationAdapter, NarrationSegment } from "./NarrationPlayer";

export interface SessionNarrationTransport {
  narrate(prompt: string, expectedText: string, signal: AbortSignal, onStarted: () => void): Promise<void>;
}

const FIXED_READ_PROMPT = "请逐字朗读：";
const MAX_FIXED_CHUNK = 80 - Array.from(FIXED_READ_PROMPT).length;

export function splitFixedNarration(text: string): string[] {
  const chars = Array.from(text.trim());
  const result: string[] = [];
  const punctuation = new Set(Array.from("。！？；，、.!?;"));
  while (chars.length) {
    if (chars.length <= MAX_FIXED_CHUNK) { result.push(chars.join("")); break; }
    let end = MAX_FIXED_CHUNK;
    for (let index = MAX_FIXED_CHUNK - 1; index >= Math.max(1, MAX_FIXED_CHUNK - 20); index -= 1) {
      if (punctuation.has(chars[index - 1] ?? "")) { end = index; break; }
    }
    result.push(chars.splice(0, end).join(""));
  }
  return result.filter((chunk) => chunk.trim().length > 0);
}

class SessionNarrationAdapter implements NarrationAdapter {
  private transport: SessionNarrationTransport | null = null;
  private browserFallback = false;
  private readonly browser = new BrowserSpeechAdapter();

  attach(transport: SessionNarrationTransport): () => void {
    this.transport = transport;
    return () => { if (this.transport === transport) this.transport = null; };
  }

  useBrowserFallback(): void { this.browserFallback = true; }

  play(segment: NarrationSegment, signal: AbortSignal, onStarted: () => void): Promise<void> {
    if (this.browserFallback) return this.browser.play(segment, signal, onStarted);
    if (!this.transport) return Promise.reject(new Error("请先开启当前展台的小智语音，再播放固定故事讲述"));
    return this.narrateChunks(segment.text, signal, onStarted);
  }

  private async narrateChunks(text: string, signal: AbortSignal, onStarted: () => void): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error("请先开启当前展台的小智语音，再播放固定故事讲述");
    const chunks = splitFixedNarration(text);
    if (!chunks.length) throw new Error("固定故事讲述正文为空");
    for (const chunk of chunks) {
      if (signal.aborted) throw new DOMException("讲述已取消", "AbortError");
      await transport.narrate(`${FIXED_READ_PROMPT}${chunk}`, chunk, signal, onStarted);
    }
  }
}

interface RuntimeEntry {
  focus: AudioFocus;
  player: NarrationPlayer;
  adapter: SessionNarrationAdapter;
  leases: number;
}

const sessions = new Map<string, RuntimeEntry>();

/** Shares one narration channel between the story stage and the live voice controller. */
export function acquireSessionNarration(sessionId: string): {
  focus: AudioFocus;
  player: NarrationPlayer;
  useBrowserFallback(): void;
  release(): void;
} {
  if (!sessionId) throw new Error("缺少语音会话身份");
  let runtime = sessions.get(sessionId);
  if (!runtime) {
    const focus = new AudioFocus();
    const adapter = new SessionNarrationAdapter();
    runtime = { focus, adapter, player: new NarrationPlayer(adapter, focus), leases: 0 };
    sessions.set(sessionId, runtime);
  }
  runtime.leases += 1;
  let released = false;
  return {
    focus: runtime.focus,
    player: runtime.player,
    useBrowserFallback: () => runtime!.adapter.useBrowserFallback(),
    release: () => {
      if (released) return;
      released = true;
      runtime!.leases -= 1;
      if (runtime!.leases === 0) {
        runtime!.focus.stop();
        runtime!.player.leave();
        sessions.delete(sessionId);
      }
    },
  };
}

export function attachSessionNarrationTransport(sessionId: string, transport: SessionNarrationTransport): () => void {
  const runtime = sessions.get(sessionId);
  if (!runtime) throw new Error("当前展台朗读通道尚未打开");
  return runtime.adapter.attach(transport);
}
