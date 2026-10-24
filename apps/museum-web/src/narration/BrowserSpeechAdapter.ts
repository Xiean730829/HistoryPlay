import type { NarrationAdapter, NarrationSegment } from "./NarrationPlayer";

/** Optional first-edition fixed-text adapter. Browser voices require real H4/H6 testing. */
export class BrowserSpeechAdapter implements NarrationAdapter {
  play(segment: NarrationSegment, signal: AbortSignal, onStarted: () => void): Promise<void> {
    if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
      return Promise.reject(new Error("当前浏览器不支持固定正文朗读"));
    }
    if (signal.aborted) return Promise.reject(new DOMException("朗读已中断", "AbortError"));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.lang = "zh-CN";
      const voices = speechSynthesis.getVoices();
      const chinese = voices.find((voice) => /^zh(-|_)/i.test(voice.lang));
      if (chinese) utterance.voice = chinese;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => {
        speechSynthesis.cancel();
        finish(new DOMException("朗读已中断", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      utterance.onstart = onStarted;
      utterance.onend = () => finish();
      utterance.onerror = () => finish(new Error("固定正文朗读失败，请重试"));
      speechSynthesis.speak(utterance);
    });
  }
}
