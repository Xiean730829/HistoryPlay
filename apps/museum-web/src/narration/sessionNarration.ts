import { AudioFocus } from "./AudioFocus";
import { BrowserSpeechAdapter } from "./BrowserSpeechAdapter";
import { NarrationPlayer } from "./NarrationPlayer";
import type { NarrationAdapter, NarrationSegment } from "./NarrationPlayer";
import type { FixedNarrationMeta } from "../voice/VoiceClient";

export interface SessionNarrationTransport {
  narrate(
    prompt: string,
    expectedText: string,
    signal: AbortSignal,
    onStarted: () => void,
    meta?: FixedNarrationMeta,
  ): Promise<void>;
}

const FIXED_READ_PROMPT = "请重复下面这句话：";
const MAX_FIXED_CHUNK = 80 - Array.from(FIXED_READ_PROMPT).length;

function splitFixedSentences(text: string): string[] {
  const chars = Array.from(text.trim());
  const result: string[] = [];
  const punctuation = new Set(Array.from("。！？；，、.!?;"));
  while (chars.length) {
    const limit = Math.min(chars.length, MAX_FIXED_CHUNK);
    let end = limit;
    const sentenceEnd = chars.slice(0, limit).findIndex((char, index) =>
      /[。！？!?；;]/u.test(char) || (char === "." && !/\d/u.test(chars[index - 1] ?? "")),
    );
    if (sentenceEnd >= 0) end = sentenceEnd + 1;
    else if (chars.length > MAX_FIXED_CHUNK) {
      for (let index = limit - 1; index >= Math.max(1, limit - 20); index -= 1) {
        if (punctuation.has(chars[index - 1] ?? "")) { end = index; break; }
      }
    }
    result.push(chars.splice(0, end).join(""));
  }
  return result.filter((chunk) => chunk.trim().length > 0);
}

export function splitFixedNarration(text: string): string[] {
  const sentences = splitFixedSentences(text);
  const chunks: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const first = sentences[index]!;
    const second = sentences[index + 1];
    if (second && Array.from(first + second).length <= MAX_FIXED_CHUNK) {
      chunks.push(first + second);
      index += 1;
    } else {
      chunks.push(first);
    }
  }
  return chunks;
}

class SessionNarrationAdapter implements NarrationAdapter {
  private transport: SessionNarrationTransport | null = null;
  private browserFallback = false;
  private readonly browser = new BrowserSpeechAdapter();
  private failedChunk: { text: string; index: number; reason: string } | null = null;

  attach(transport: SessionNarrationTransport): () => void {
    this.transport = transport;
    return () => { if (this.transport === transport) this.transport = null; };
  }

  useBrowserFallback(): void { this.browserFallback = true; }

  play(segment: NarrationSegment, signal: AbortSignal, onStarted: () => void): Promise<void> {
    if (this.browserFallback) return this.browser.play(segment, signal, onStarted);
    if (!this.transport) return Promise.reject(new Error("请先开启当前展台的小智语音，再播放固定故事讲述"));
    return this.narrateChunks(segment.text, signal, onStarted, segment.contentId);
  }

  private async narrateChunks(
    text: string,
    signal: AbortSignal,
    onStarted: () => void,
    segmentId: string,
  ): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error("请先开启当前展台的小智语音，再播放固定故事讲述");
    const chunks = splitFixedNarration(text);
    if (!chunks.length) throw new Error("固定故事讲述正文为空");
    const resume = this.failedChunk?.text === text ? this.failedChunk.index : 0;
    this.failedChunk = null;
    for (let index = resume; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      if (signal.aborted) throw new DOMException("讲述已取消", "AbortError");
      try {
        await transport.narrate(`${FIXED_READ_PROMPT}${chunk}`, chunk, signal, onStarted, {
          segmentId,
          chunkIndex: index,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        // If the provider reads only part of a paired request, retry the two
        // sentences separately. Never treat a partial reply as completed text.
        const fallback = splitFixedSentences(chunk);
        if (error instanceof Error && error.message.includes("小智语音字幕与固定正文不一致")
          && fallback.length === 2) {
          try {
            for (const sentence of fallback) {
              if (signal.aborted) throw new DOMException("讲述已取消", "AbortError");
              await transport.narrate(`${FIXED_READ_PROMPT}${sentence}`, sentence, signal, onStarted, {
                segmentId, chunkIndex: index,
              });
            }
            continue;
          } catch (fallbackError) {
            if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") throw fallbackError;
            const reason = fallbackError instanceof Error ? fallbackError.message : "固定稿片段未能完成";
            this.failedChunk = { text, index, reason };
            throw new Error(`第${index + 1}/${chunks.length}段未能完成：${reason}。可重试当前片段，不会把等待伪装成下一句。`);
          }
        }
        const reason = error instanceof Error ? error.message : "固定稿片段未能完成";
        this.failedChunk = { text, index, reason };
        throw new Error(`第${index + 1}/${chunks.length}段未能完成：${reason}。可重试当前片段，不会把等待伪装成下一句。`);
      }
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
