import { useEffect, useRef, useState } from "react";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { GameVoiceController } from "../voice/GameVoiceController";
import type { RenderAcknowledgement } from "../voice/VoiceClient";
import { VoiceEntry } from "./VoiceEntry";

export function GameVoicePanel({ session, onRefresh, onNewInput, onStoryTransition, gameUrl, bridgeUrl }: {
  session: ActiveSession;
  onRefresh: (receipt?: CommandReceipt) => Promise<RenderAcknowledgement>;
  onNewInput?: () => void;
  onStoryTransition?: (action: string) => void;
  gameUrl?: string;
  bridgeUrl?: string;
}) {
  const controller = useRef<GameVoiceController | null>(null);
  const latest = useRef({ session, onRefresh });
  latest.current = { session, onRefresh };
  const [status, setStatus] = useState("语音尚未开启");
  const [caption, setCaption] = useState("");
  useEffect(() => () => { controller.current?.dispose(); controller.current = null; }, [session.connection_id]);

  return <aside aria-label="语音讲解">
    <VoiceEntry beforeStart={async () => {
      controller.current?.dispose();
      const current = new GameVoiceController(latest.current.session, {
        onStatus: setStatus, onTranscript: setCaption, onNewInput, onStoryTransition,
        onRefresh: (receipt) => latest.current.onRefresh(receipt),
      }, gameUrl, bridgeUrl);
      controller.current = current;
      try { await current.initialize(); }
      catch (error) { current.dispose(); throw error; }
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
