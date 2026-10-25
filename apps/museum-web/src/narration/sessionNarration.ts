import { AudioFocus } from "./AudioFocus";
import { BrowserSpeechAdapter } from "./BrowserSpeechAdapter";
import { NarrationPlayer } from "./NarrationPlayer";

interface RuntimeEntry {
  focus: AudioFocus;
  player: NarrationPlayer;
  leases: number;
}

const sessions = new Map<string, RuntimeEntry>();

/** Shares one narration channel between the story stage and the live voice controller. */
export function acquireSessionNarration(sessionId: string): {
  focus: AudioFocus;
  player: NarrationPlayer;
  release(): void;
} {
  if (!sessionId) throw new Error("缺少语音会话身份");
  let runtime = sessions.get(sessionId);
  if (!runtime) {
    const focus = new AudioFocus();
    runtime = { focus, player: new NarrationPlayer(new BrowserSpeechAdapter(), focus), leases: 0 };
    sessions.set(sessionId, runtime);
  }
  runtime.leases += 1;
  let released = false;
  return {
    focus: runtime.focus,
    player: runtime.player,
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
