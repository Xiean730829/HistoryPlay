import React from "react";
import { ApiRequestError, unpairSession, type ActiveSession } from "../application/museumApi";
import { GameVoicePanel } from "../voice-ui/GameVoicePanel";
import { MuseumShell } from "./MuseumShell";
import { eraRegistry, type EraId } from "./eraRegistry";
import { EraPreparation, openVoiceBinding } from "./eraSession";
import { applyEntranceIntent, ERA_CHOICE_WELCOME, ERA_CLARIFY_SPEECH } from "./eraSelection";
import "./eraEntrance.css";

const GAME_URL = import.meta.env.VITE_MUSEUM_GAME_URL?.trim() || "http://127.0.0.1:8793";
const BRIDGE_URL = import.meta.env.VITE_MUSEUM_BRIDGE_URL?.trim() || (typeof window === "undefined" ? "http://127.0.0.1:8782" : window.location.origin);

/** Tang/Song entrance; the existing direct Tang hall remains available as a fallback. */
export function EraEntrance() {
  const [displayed, setDisplayed] = React.useState<{ era: EraId; session: ActiveSession } | null>(null);
  const [doorSession, setDoorSession] = React.useState<ActiveSession | null>(null);
  const [choosing, setChoosing] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [command, setCommand] = React.useState("");
  const [status, setStatus] = React.useState("请选择唐代或宋代；单说“好”或“可以”不会替你选馆。");
  const [voiceEpoch, setVoiceEpoch] = React.useState(0);
  const preparation = React.useRef(new EraPreparation());
  const voiceApi = React.useRef<{ pauseNarration(): void; speakPrompt(text: string): Promise<void> } | null>(null);
  const displayedRef = React.useRef(displayed);
  displayedRef.current = displayed;
  const doorRef = React.useRef(doorSession);
  doorRef.current = doorSession;
  const alive = React.useRef(true);
  const opening = React.useRef(false);
  const doorOpening = React.useRef<Promise<ActiveSession> | null>(null);
  const voiceActive = React.useRef(false);
  const voiceMode = React.useRef<"gate" | "manual">("gate");
  const deferredRelease = React.useRef<{
    keptId: string; sessions: Array<ActiveSession | null | undefined>;
  } | null>(null);

  React.useEffect(() => {
    alive.current = true;
    let active = true;
    // StrictMode may mount this effect twice. Reuse the same in-flight pairing
    // so the second request cannot revoke the first connection's ticket.
    const pending = doorOpening.current ?? openVoiceBinding(eraRegistry.tang);
    doorOpening.current = pending;
    void pending.then((session) => {
      if (!active || !alive.current) return;
      setDoorSession(session);
    }).catch((error: unknown) => {
      if (!active || !alive.current) return;
      setStatus(error instanceof Error
        ? `入口语音尚未接通：${error.message}。仍可用按钮选择朝代。`
        : "入口语音尚未接通，仍可用按钮选择朝代。");
    });
    return () => { active = false; alive.current = false; preparation.current.cancel(); };
  }, []);

  async function releaseIfReplaced(keptId: string, ...sessions: Array<ActiveSession | null | undefined>) {
    const seen = new Set<string>();
    for (const session of sessions) {
      if (!session || session.session_id === keptId || seen.has(session.session_id)) continue;
      seen.add(session.session_id);
      await unpairSession(session).catch(() => undefined);
    }
  }

  function handleVoiceActive(active: boolean) {
    voiceActive.current = active;
    const pending = deferredRelease.current;
    if (pending) {
      deferredRelease.current = null;
      void releaseIfReplaced(pending.keptId, ...pending.sessions);
    }
  }

  async function select(era: EraId) {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setStatus(`正在核对${eraRegistry[era].title}的已发布内容…`);
    const previous = displayedRef.current;
    try {
      // Finish door pairing before binding a selected hall, including when a
      // user clicks an era immediately after opening the page.
      const door = await doorOpening.current?.catch(() => null);
      const next = await preparation.current.prepare(
        eraRegistry[era], undefined, undefined, () => voiceApi.current?.pauseNarration(),
      );
      if (!next || !alive.current) return;
      const oldSessions = [previous?.session, doorRef.current, door];
      // The bridge retires old audio using its old session binding. Keep that
      // binding valid until the new panel has connected or reported failure.
      if (voiceActive.current) deferredRelease.current = {
        keptId: next.session_id, sessions: [...(deferredRelease.current?.sessions ?? []), ...oldSessions],
      };
      setDisplayed({ era, session: next });
      setChoosing(false);
      setStatus("所选会话已准备，正在加载实际展厅。");
      if (!voiceActive.current) await releaseIfReplaced(next.session_id, ...oldSessions);
      if (door && door.session_id !== next.session_id) setDoorSession(null);
    } catch (error) {
      if (!alive.current) return;
      const kept = displayedRef.current;
      if (kept) setChoosing(true);
      setStatus(error instanceof ApiRequestError && error.status === 404
        ? `${eraRegistry[era].title}尚未开放：当前运行服务中没有该版本。${kept ? "已保留原展厅会话。" : "未替换入口会话。"}`
        : error instanceof Error
          ? `未能进入所选展厅：${error.message}${kept ? " 原展厅会话仍在。" : ""}`
          : "展厅准备失败，请重试。");
    } finally {
      opening.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    applyEntranceIntent(command, (next) => { void select(next); }, () => {
      setStatus(ERA_CLARIFY_SPEECH);
    });
  }

  if (displayed && !choosing) return <MuseumShell
    key={`${displayed.session.session_id}:${displayed.session.connection_id}`}
    preparedSession={displayed.session}
    era={eraRegistry[displayed.era]}
    autoStartVoice={voiceActive.current}
    initialVoiceMode={voiceMode.current}
    onVoiceActiveChange={handleVoiceActive}
    onVoiceModeChange={(mode) => { voiceMode.current = mode; }}
    onChangeEra={() => {
      voiceApi.current?.pauseNarration();
      setChoosing(true);
      setVoiceEpoch((value) => value + 1);
      setStatus("旧讲解已暂停。请选择进入唐代或宋代，语音会按先前状态重新连接。");
    }}
    onSelectEra={(next) => { void select(next); }}
  />;

  const voiceSession = displayed?.session ?? doorSession;
  return <main className="era-entrance">
    <header className="era-heading">
      <p className="era-kicker">HISTORY PLAY · A MUSEUM ACROSS TIME</p>
      <h1>时空博物馆</h1>
      <p>推开时光之门，走进一段故事。</p>
    </header>
    <div className="era-choices" aria-label="选择朝代">
      {(["tang", "song"] as const).map((id) => <button type="button" key={id} disabled={busy}
        onClick={() => void select(id)} className={`era-choice era-choice-${id}`}
        aria-label={`进入${id === "tang" ? "唐代" : "宋代"}展厅`}>
        <span className="era-choice-kicker">{id === "tang" ? "THE TANG DYNASTY" : "THE SONG DYNASTY"}</span>
        <strong>{id === "tang" ? "大唐 · 盛世" : "大宋 · 风雅"}</strong>
        <span className="era-choice-description">{id === "tang" ? "赴一场繁华盛宴，寻见大唐气象" : "展开一卷山水，细看宋人雅趣"}</span>
        <span className="era-choice-enter">{id === "tang" ? "进入唐代" : "进入宋代"}<span aria-hidden="true"> ↗</span></span>
      </button>)}
    </div>
    <div className="era-controls">
    {voiceSession
      ? <GameVoicePanel
          key={`era-voice:${voiceSession.session_id}:${voiceSession.connection_id}:${voiceEpoch}`}
          session={voiceSession}
          autoStart={Boolean(displayed && voiceActive.current)}
          initialMode={voiceMode.current}
          onActiveChange={handleVoiceActive}
          onModeChange={(mode) => { voiceMode.current = mode; }}
          portalActive
          welcomeOnConnect
          welcomeText={ERA_CHOICE_WELCOME}
          gameUrl={GAME_URL}
          bridgeUrl={BRIDGE_URL}
          onReady={(api) => { voiceApi.current = api; }}
          onUserTranscript={(text) => {
            applyEntranceIntent(text, (next) => { void select(next); }, () => {
              setStatus(ERA_CLARIFY_SPEECH);
              void voiceApi.current?.speakPrompt(ERA_CLARIFY_SPEECH);
            });
          }}
          onRefresh={async () => "pending"}
        />
      : <p className="era-note">
          正在准备讲解员，你也可以先选择一个展厅。
        </p>}
    <p className="era-status" role="status" aria-live="polite">{status}</p>
    <details className="era-text-choice">
      <summary>文字选择朝代</summary>
      <form onSubmit={submit} className="era-command">
        <label htmlFor="era-command">输入朝代</label>
        <input id="era-command" value={command} disabled={busy} onChange={(event) => setCommand(event.target.value)} placeholder="例如：进入宋代" />
        <button type="submit" disabled={busy || !command.trim()}>进入</button>
      </form>
    </details>
    {displayed && <button type="button" disabled={busy} onClick={() => {
      voiceApi.current?.pauseNarration();
      setChoosing(false);
    }}>返回原展厅</button>}
    <a className="era-tang-legacy" href="/?legacy=1">直接进入唐代展厅</a>
    </div>
  </main>;
}
