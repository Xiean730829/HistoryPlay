import { useEffect, useRef, useState } from "react";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { GameVoiceController } from "../voice/GameVoiceController";
import type { RenderAcknowledgement } from "../voice/VoiceClient";
import { claimPortalWelcome } from "../voice/portalWelcomeGate";
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
  const latest = useRef({ session, onRefresh });
  latest.current = { session, onRefresh };
  const [status, setStatus] = useState("语音尚未开启");
  const [caption, setCaption] = useState("");
  useEffect(() => () => { controller.current?.dispose(); controller.current = null; }, [session.connection_id]);

  return <aside aria-label="语音讲解" data-portal-active={portalActive || undefined}>
    <VoiceEntry beforeStart={async () => {
      controller.current?.dispose();
      const current = new GameVoiceController(latest.current.session, {
        onStatus: setStatus, onTranscript: setCaption, onUserTranscript, onNewInput, onStoryTransition,
        onRefresh: (receipt) => latest.current.onRefresh(receipt),
      }, gameUrl, bridgeUrl);
      controller.current = current;
      try { await current.initialize(); }
      catch (error) { current.dispose(); throw error; }
    }} afterConnect={async () => {
      if (!welcomeOnConnect || !claimPortalWelcome(session.session_id)) return;
      try {
        await controller.current?.speakWelcome();
      } catch {
        return "入口欢迎语暂未播出；语音仍可开启并直接说“可以”进入，或提问。";
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
