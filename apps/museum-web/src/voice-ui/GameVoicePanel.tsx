import { useEffect, useRef, useState } from "react";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { GameVoiceController } from "../voice/GameVoiceController";
import type { RenderAcknowledgement } from "../voice/VoiceClient";
import { claimPortalWelcome, finishPortalWelcome } from "../voice/portalWelcomeGate";
import { VoiceEntry } from "./VoiceEntry";

export function GameVoicePanel({ session, onRefresh, onNewInput, onStoryTransition, onUserTranscript,
  portalActive = false, welcomeOnConnect = false, gameUrl, bridgeUrl }: {
  session: ActiveSession;
  onRefresh: (receipt?: CommandReceipt) => Promise<RenderAcknowledgement>;
  onNewInput?: () => void;
  onStoryTransition?: (action: string) => void;
  onUserTranscript?: (text: string) => void;
  portalActive?: boolean;
  welcomeOnConnect?: boolean;
  gameUrl?: string;
  bridgeUrl?: string;
}) {
  const controller = useRef<GameVoiceController | null>(null);
  const latest = useRef({ session, onRefresh, onNewInput, onStoryTransition, onUserTranscript });
  latest.current = { session, onRefresh, onNewInput, onStoryTransition, onUserTranscript };
  const [status, setStatus] = useState("语音尚未开启");
  const [caption, setCaption] = useState("");
  useEffect(() => () => { controller.current?.dispose(); controller.current = null; }, [session.connection_id]);

  return <aside aria-label="语音讲解" data-portal-active={portalActive || undefined}>
    <VoiceEntry beforeStart={async () => {
      controller.current?.dispose();
      const current = new GameVoiceController(latest.current.session, {
        onStatus: setStatus, onTranscript: setCaption,
        onUserTranscript: (text) => latest.current.onUserTranscript?.(text),
        onNewInput: () => latest.current.onNewInput?.(),
        onStoryTransition: (action) => latest.current.onStoryTransition?.(action),
        onRefresh: (receipt) => latest.current.onRefresh(receipt),
      }, gameUrl, bridgeUrl);
      controller.current = current;
      try { await current.initialize(); }
      catch (error) { current.dispose(); throw error; }
    }} afterConnect={async () => {
      if (!welcomeOnConnect || !claimPortalWelcome(session.session_id)) return;
      let playedToCompletion = false;
      try {
        const activeController = controller.current;
        if (!activeController) return;
        await activeController.speakWelcome();
        playedToCompletion = true;
      } catch {
        setStatus("入口欢迎语暂未播出；语音仍可使用，可以直接说“可以”进入或提问");
      } finally {
        finishPortalWelcome(session.session_id, playedToCompletion);
      }
    }} onStop={() => { controller.current?.dispose(); controller.current = null; }} callbacks={{
      onSpeechStarted: () => controller.current?.beginTurn(),
      onSpeechEnded: () => controller.current?.endTurn(),
      onFrame: (frame) => controller.current?.sendFrame(frame.pcm),
      onDisconnected: () => controller.current?.dispose(),
    }} />
    <p role="status" aria-live="polite">{status}</p>
    {caption && <p className="voice-caption">{caption}</p>}
  </aside>;
}
