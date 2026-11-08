import { useEffect, useRef, useState } from "react";
import type { ActiveSession } from "../application/museumApi";
import type { CommandReceipt } from "@history-play/contracts";
import { GameVoiceController } from "../voice/GameVoiceController";
import type { RenderAcknowledgement } from "../voice/VoiceClient";
import { claimPortalWelcome, finishPortalWelcome } from "../voice/portalWelcomeGate";
import { VoiceEntry } from "./VoiceEntry";

export function GameVoicePanel({ session, onRefresh, onNewInput, onStoryTransition, onUserTranscript,
  onPresentation, onReady, portalActive = false, welcomeOnConnect = false, welcomeText, gameUrl, bridgeUrl,
  autoStart = false, initialMode = "gate", onActiveChange, onModeChange }: {
  session: ActiveSession;
  onRefresh: (receipt?: CommandReceipt) => Promise<RenderAcknowledgement>;
  onNewInput?: () => void;
  onStoryTransition?: (action: string) => void;
  onUserTranscript?: (text: string) => void;
  onPresentation?: (action: "focus_current" | "return_to_overview") => Promise<RenderAcknowledgement>;
  onReady?: (api: {
    noteClickInspection(artifactId: string, revision: number): Promise<void>;
    pauseNarration(): void;
    speakPrompt(text: string): Promise<void>;
  } | null) => void;
  portalActive?: boolean;
  welcomeOnConnect?: boolean;
  welcomeText?: string;
  gameUrl?: string;
  bridgeUrl?: string;
  autoStart?: boolean;
  initialMode?: "gate" | "manual";
  onActiveChange?: (active: boolean) => void;
  onModeChange?: (mode: "gate" | "manual") => void;
}) {
  const controller = useRef<GameVoiceController | null>(null);
  const latest = useRef({ session, onRefresh, onNewInput, onStoryTransition, onUserTranscript, onPresentation, onReady, welcomeText });
  latest.current = { session, onRefresh, onNewInput, onStoryTransition, onUserTranscript, onPresentation, onReady, welcomeText };
  const [status, setStatus] = useState("语音尚未开启");
  const [caption, setCaption] = useState("");
  useEffect(() => () => {
    controller.current?.dispose();
    controller.current = null;
    latest.current.onReady?.(null);
  }, [session.connection_id]);

  return <aside aria-label="语音讲解" data-portal-active={portalActive || undefined}>
    <VoiceEntry autoStart={autoStart} initialMode={initialMode} onActiveChange={onActiveChange}
      onSettings={(_settings, mode) => onModeChange?.(mode)} beforeStart={async () => {
      controller.current?.dispose();
      const current = new GameVoiceController(latest.current.session, {
        onStatus: setStatus, onTranscript: setCaption,
        onUserTranscript: (text) => latest.current.onUserTranscript?.(text),
        onNewInput: () => latest.current.onNewInput?.(),
        onStoryTransition: (action) => latest.current.onStoryTransition?.(action),
        onPresentation: (action) => latest.current.onPresentation?.(action) ?? Promise.resolve("pending"),
        onRefresh: (receipt) => latest.current.onRefresh(receipt),
      }, gameUrl, bridgeUrl);
      controller.current = current;
      try {
        await current.initialize();
        latest.current.onReady?.({
          noteClickInspection: (artifactId, revision) => current.noteClickInspection(artifactId, revision),
          pauseNarration: () => current.pauseNarration(),
          speakPrompt: (text) => current.speakPrompt(text),
        });
      }
      catch (error) {
        current.dispose();
        controller.current = null;
        latest.current.onReady?.(null);
        throw error;
      }
    }} afterConnect={async (captureApi) => {
      if (!welcomeOnConnect || !claimPortalWelcome(session.session_id)) {
        captureApi.rearmAfterWelcome();
        return;
      }
      const activeController = controller.current;
      if (!activeController || captureApi.isStopped()) {
        finishPortalWelcome(session.session_id, false);
        captureApi.rearmAfterWelcome();
        return;
      }
      captureApi.setWelcomeHoldOnly(true);
      const captureLifecycle = captureApi.getLifecycle();
      let playedToCompletion = false;
      try {
        if (latest.current.welcomeText) await activeController.speakWelcome(latest.current.welcomeText);
        else await activeController.speakWelcome();
        playedToCompletion = true;
      } catch (error) {
        setStatus(error instanceof Error
          ? error.message
          : "入口欢迎语暂未播出；语音仍可使用，可以直接说“可以”进入或提问");
      } finally {
        finishPortalWelcome(session.session_id, playedToCompletion);
        const sameCapture = !captureApi.isStopped() && captureApi.getLifecycle() === captureLifecycle;
        const sameController = controller.current === activeController;
        if (sameCapture && sameController) captureApi.rearmAfterWelcome();
      }
    }} onStop={() => {
      controller.current?.dispose(); controller.current = null; latest.current.onReady?.(null);
      setStatus("语音已暂停"); setCaption("");
    }} callbacks={{
      onSpeechStarted: () => {
        const current = controller.current;
        if (!current) return;
        current.beginTurn(current.isWelcomeActive() ? "user_manual_interrupt" : "gate_confirmed");
      },
      onSpeechEnded: () => controller.current?.endTurn(),
      onSpeechCandidate: () => controller.current?.noteCandidate(),
      onSpeechMisfire: () => controller.current?.noteMisfire(),
      onFrame: (frame) => controller.current?.sendFrame(frame.pcm),
      onDisconnected: () => controller.current?.dispose(),
    }} />
    <p role="status" aria-live="polite">{status}</p>
    {caption && <p className="voice-caption">{caption}</p>}
  </aside>;
}
