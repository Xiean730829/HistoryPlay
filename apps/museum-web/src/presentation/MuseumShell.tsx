import React from "react";
import type { CommandReceipt } from "@history-play/contracts";
import {
  createSession,
  restoreSession,
  searchArtifacts,
  openArtifact,
  moveGalleryStation,
  enterGallery,
  unpairSession,
  requestEventTicket,
  refreshSession,
  loadGalleryArtifacts,
  enterStory,
  continueStory,
  returnToExhibit,
  reportRenderReceipt,
  prepareArtifactInspection,
  setArtifactView,
  type ActiveSession,
  type ArtifactProjection,
  type SessionCredentials,
  type SearchHit,
} from "../application/museumApi";
import { EventChannel } from "../api/eventChannel";
import { SessionProjectionStore } from "../state/sessionProjection";
import { ExhibitList } from "./ExhibitList";
import { StatusNotice } from "./StatusNotice";
import { MuseumSpace } from "../scene3d/MuseumSpace";
import { GameVoicePanel } from "../voice-ui/GameVoicePanel";
import { ArtifactStoryStage } from "../story/ArtifactStoryStage";
import { RenderReceiptReporter } from "../capabilities/RenderReceiptReporter";

const SESSION_KEY = "history-play.session.v1";
const DEFAULT_PACK_ID = import.meta.env.VITE_MUSEUM_PACK_ID?.trim() || "cn.tang.core";
const DEFAULT_VERSION = import.meta.env.VITE_MUSEUM_PACK_VERSION?.trim() || "0.2.1";
const DEFAULT_GALLERY_ID =
  import.meta.env.VITE_MUSEUM_GALLERY_ID?.trim() || "cn.tang.gallery.main";
const SHOW_DIAGNOSTICS = new URLSearchParams(window.location.search).get("debug") === "1";
type Health = { status: "ok"; service: string };
type OpenedMuseum = { active: ActiveSession; receipt?: CommandReceipt };

export function MuseumShell() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthError, setHealthError] = React.useState(false);
  const [session, setSession] = React.useState<ActiveSession | null>(null);
  const [renderCommand, setRenderCommand] = React.useState<CommandReceipt | null>(null);
  const [galleryArtifacts, setGalleryArtifacts] = React.useState<ArtifactProjection[]>([]);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [inspection, setInspection] = React.useState(false);
  const previousFocus = React.useRef<string | null>(null);
  const [notice, setNotice] = React.useState("正在连接本地游戏服务…");
  const [noticeTone, setNoticeTone] = React.useState<"info" | "error" | "success">("info");
  const restoreTask = React.useRef<Promise<OpenedMuseum> | null>(null);
  const projectionStore = React.useRef<SessionProjectionStore | null>(null);
  const renderReporter = React.useRef(new RenderReceiptReporter(reportRenderReceipt));

  React.useEffect(() => {
    const focus = session?.state.focused_entity_id ?? null;
    if (previousFocus.current && focus !== previousFocus.current) setInspection(true);
    previousFocus.current = focus;
  }, [session?.state.focused_entity_id]);

  async function selectExhibit(id: string) {
    if (!session || busy || session.state.mode !== "explore") return;
    const current = projectionStore.current?.snapshot ?? session;
    setBusy(true);
    try {
      const result = await prepareArtifactInspection(current, id);
      if (projectionStore.current) await projectionStore.current.acceptQuery(result.session);
      else setSession(result.session);
      if (result.receipt?.status === "committed") setRenderCommand(result.receipt);
      if (result.session.state.focused_entity_id === id) setInspection(true);
      else throw new Error(result.receipt?.reason ?? "暂时无法走近这件文物");
    } catch (error) { showError(error, setNotice, setNoticeTone); }
    finally { setBusy(false); }
  }

  async function observeExhibit(deltaYaw: number, deltaPitch: number, zoomFactor: number) {
    if (!session || busy || session.state.mode !== "explore") return;
    const pose = session.state.camera_pose ?? { yaw: 0, pitch: 0, zoom: 1 };
    setBusy(true);
    try {
      const result = await setArtifactView(session, {
        yaw: ((pose.yaw + deltaYaw + 540) % 360) - 180,
        pitch: Math.max(-45, Math.min(45, pose.pitch + deltaPitch)),
        zoom: Math.max(0.65, Math.min(2.3, pose.zoom * zoomFactor)),
      });
      if (projectionStore.current) await projectionStore.current.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status !== "committed") throw new Error(result.receipt.reason ?? "观察视角暂未改变");
    } catch (error) { showError(error, setNotice, setNoticeTone); }
    finally { setBusy(false); }
  }

  React.useEffect(() => {
    if (!session) {
      projectionStore.current = null;
      return;
    }
    const store = new SessionProjectionStore(session, () => refreshSession(session));
    projectionStore.current = store;
    const unsubscribe = store.subscribe(setSession);
    const channel = new EventChannel({
      session,
      getCursor: () => store.snapshot.state.event_seq,
      requestTicket: requestEventTicket,
      onEvent: (event) => { void store.receiveEvent(event).catch((error: unknown) => showError(error, setNotice, setNoticeTone)); },
      onSnapshot: (eventSeq) => { void store.receiveSnapshot(eventSeq).catch((error: unknown) => showError(error, setNotice, setNoticeTone)); },
    });
    channel.start();
    return () => {
      channel.stop();
      unsubscribe();
      if (projectionStore.current === store) projectionStore.current = null;
    };
  }, [session?.session_id, session?.connection_id]);

  React.useEffect(() => {
    let current = true;
    setGalleryArtifacts([]);
    if (!session?.state.gallery_id) return () => { current = false; };
    void loadGalleryArtifacts(session, session.state.gallery_id)
      .then((artifacts) => { if (current) setGalleryArtifacts(artifacts); })
      .catch((error: unknown) => { if (current) showError(error, setNotice, setNoticeTone); });
    return () => { current = false; };
  }, [session?.session_id, session?.connection_id, session?.state.gallery_id]);

  React.useEffect(() => {
    let current = true;
    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`游戏服务返回 ${response.status}`);
        return (await response.json()) as Health;
      })
      .then((value) => {
        if (!current) return;
        setHealth(value);
        restoreTask.current ??= openDefaultSession();
        restoreTask.current
          .then(({ active, receipt }) => {
            if (!current) return;
            setSession(active);
            setRenderCommand(receipt ?? null);
            setNotice("已进入唐朝长廊。文物顺序与年代由当前发布版本和服务端状态决定。");
            setNoticeTone("success");
          })
          .catch((error: unknown) => {
            if (current) showError(error, setNotice, setNoticeTone);
          });
      })
      .catch(() => {
        if (current) setHealthError(true);
      });
    return () => {
      current = false;
    };
  }, []);

  async function startMuseum() {
    setBusy(true);
    try {
      restoreTask.current = null;
      const opened = await openDefaultSession();
      const { active, receipt } = opened;
      restoreTask.current = Promise.resolve(opened);
      setSession(active);
      setRenderCommand(receipt ?? null);
      setResults([]);
      setQuery("");
      setNotice("已进入唐朝长廊。文物顺序与年代由当前发布版本和服务端状态决定。");
      setNoticeTone("success");
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    try {
      const items = await searchArtifacts(session, query.trim());
      setResults(items);
      setNotice(items.length ? `找到 ${items.length} 件当前版本的文物。` : "当前固定版本中没有匹配的文物。");
      setNoticeTone("info");
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function addToMuseum(artifactId: string) {
    if (!session) return;
    setBusy(true);
    try {
      const result = await openArtifact(session, artifactId);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setNotice("展品已按服务端状态开放，并已更新展厅顺序。");
        setNoticeTone("success");
      } else {
        setNotice(result.receipt.reason ?? "操作未提交，请检查当前会话状态后重试。");
        setNoticeTone("error");
      }
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function moveStation(direction: "next" | "previous") {
    if (!session) return;
    setRenderCommand(null);
    setBusy(true);
    try {
      const result = await moveGalleryStation(session, direction);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setNotice(direction === "next" ? "已前进到服务端确认的展位。" : "已后退到服务端确认的展位。");
        setNoticeTone("success");
      } else {
        setNotice(result.receipt.reason ?? "展位未改变，当前焦点保持不变。");
        setNoticeTone("error");
      }
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function runStoryAction(action: "enter" | "continue" | "return") {
    if (!session) return;
    const focused = session.context.focused_artifact;
    const storyId = focused?.story_entry_ids?.[0];
    if (action === "enter" && !storyId) return;
    setBusy(true);
    try {
      const result = action === "enter"
        ? await enterStory(session, storyId!)
        : action === "continue"
          ? await continueStory(session)
          : await returnToExhibit(session);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setNotice(action === "return" ? "故事已退出，正在恢复原展台与相机。" : "已切换到服务端提交的故事段落。");
        setNoticeTone("success");
      } else {
        setNotice(result.receipt.reason ?? "故事状态未提交，展台保持当前状态。");
        setNoticeTone("error");
      }
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function leaveMuseum() {
    let unpairFailed = false;
    if (session) {
      try {
        await unpairSession(session);
      } catch {
        unpairFailed = true;
      }
    }
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setResults([]);
    setQuery("");
    setNotice(
      unpairFailed ? "本地凭证已清除，但服务端未确认解除配对。" : "本地展厅会话已清除。",
    );
    setNoticeTone(unpairFailed ? "error" : "info");
  }

  return (
    <main className="museum-page museum-page-spatial">
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true">时</div>
        <div>
          <p className="eyebrow">HISTORY PLAY · DIGITAL EXHIBITION</p>
          <h1>时空博物馆</h1>
        </div>
        <div className={`service-status ${health ? "is-ready" : healthError ? "has-error" : ""}`} role="status">
          <span className="status-dot" />
          {health ? `${health.service} 已连接` : healthError ? "游戏服务未连接" : "正在连接游戏服务"}
        </div>
      </header>

      {(noticeTone === "error" || SHOW_DIAGNOSTICS) && <StatusNotice message={notice} tone={noticeTone} />}

      {session && <MuseumSpace
        artifacts={galleryArtifacts.length ? galleryArtifacts : session.context.visible_artifacts}
        session={session}
        inspection={inspection}
        onSelect={(id) => void selectExhibit(id)}
        onObserve={(yaw, pitch, zoom) => void observeExhibit(yaw, pitch, zoom)}
        onRender={(status, reason) => {
          if (session.state.mode === "explore") void renderReporter.current.report(session, renderCommand, status, reason).catch(() => undefined);
        }}
      />}
      {session?.state.mode === "story" && (
        <ArtifactStoryStage
          session={session}
          busy={busy}
          onContinue={() => void runStoryAction("continue")}
          onReturn={() => void runStoryAction("return")}
        />
      )}

      {session?.state.mode === "explore" && inspection && session.context.focused_artifact?.story_entry_ids?.length ? (
        <div className="story-entry-row">
          <span>{session.context.focused_artifact.title} · 它经历了怎样的时代？</span>
          <button
            className="button"
            disabled={busy}
            onClick={() => void runStoryAction("enter")}
            type="button"
          >
            {busy ? "正在打开…" : "进入故事"}
          </button>
          <button className="button button-quiet" onClick={() => setInspection(false)} type="button">继续参观</button>
        </div>
      ) : null}

      {session?.state.mode === "explore" && <nav className="museum-walk-controls" aria-label="长廊漫步">
        <button disabled={busy} onClick={() => void moveStation("previous")} type="button">← 上一件</button>
        <span>{session.context.focused_artifact?.title ?? "大唐文物"}</span>
        <button disabled={busy} onClick={() => void moveStation("next")} type="button">下一件 →</button>
      </nav>}

      {session && (
        <GameVoicePanel
          key={`${session.session_id}:${session.connection_id}`}
          session={session}
          gameUrl={import.meta.env.VITE_MUSEUM_GAME_URL?.trim() || "http://127.0.0.1:8781"}
          bridgeUrl={import.meta.env.VITE_MUSEUM_BRIDGE_URL?.trim() || "http://127.0.0.1:8782"}
          onRefresh={async (receipt) => {
            const active = await refreshSession(session);
            const store = projectionStore.current;
            if (store) await store.acceptQuery(active);
            else setSession(active);
            setRenderCommand(receipt?.status === "committed" ? receipt : null);
            if (receipt?.status === "committed" && ["locate_artifact", "move_next", "move_previous", "set_view"].includes(receipt.action ?? "")) setInspection(true);
          }}
        />
      )}

      {!session && health && (
        <div className="corridor-retry-row">
          <span>展厅暂未连接，不会显示未经发布的展品。</span>
          <button className="button button-quiet" disabled={busy} onClick={() => void startMuseum()} type="button">
            {busy ? "正在重试…" : "重试连接"}
          </button>
        </div>
      )}

      {session && SHOW_DIAGNOSTICS && (
        <>
          <section className="session-strip">
            <div>
              <span className="session-label">当前展厅</span>
              <strong>{session.pack_id} <span>@ {session.version}</span></strong>
            </div>
            <div>
              <span className="session-label">服务端状态</span>
              <strong>修订 {session.state.revision} · {modeLabel(session.state.mode)}</strong>
            </div>
            <button className="button button-quiet" onClick={leaveMuseum} type="button">结束本地会话</button>
          </section>

          <section className="search-panel" aria-labelledby="search-title">
            <div className="section-heading">
              <div>
                <p className="section-kicker">馆藏检索</p>
                <h2 id="search-title">发现一件文物</h2>
              </div>
              <span className="search-caption">范围：{session.pack_id} @ {session.version}</span>
            </div>
            <form className="search-form" onSubmit={search}>
              <label className="search-field">
                <span className="visually-hidden">文物名称或别名</span>
                <input
                  aria-label="文物名称或别名"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文物名称或别名…"
                  value={query}
                />
              </label>
              <button className="button" disabled={busy || !query.trim()} type="submit">
                {busy ? "处理中…" : "搜索馆藏"}
              </button>
            </form>
          </section>

          <ExhibitList
            artifacts={session.context.visible_artifacts}
            focusedId={session.context.focused_artifact?.id ?? null}
            results={results}
            busy={busy}
            onOpen={addToMuseum}
          />
        </>
      )}

      <footer className="page-footer">
        <span>内容版本固定于会话 · 陈列顺序以服务端状态为准</span>
        {session && <span>事件序号 {session.state.event_seq}</span>}
      </footer>
    </main>
  );
}

async function restoreSavedSession(): Promise<ActiveSession | null> {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  let credentials: SessionCredentials;
  try {
    credentials = JSON.parse(saved) as SessionCredentials;
    if (!credentials.session_id || !credentials.session_token) throw new Error("本地会话数据无效");
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
  return restoreSession(credentials);
}

async function openDefaultSession(): Promise<OpenedMuseum> {
  const restored = await restoreSavedSession();
  if (restored) return ensureTangGallery(restored);

  const credentials = await createSession(DEFAULT_PACK_ID, DEFAULT_VERSION);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
  return ensureTangGallery(await restoreSession(credentials));
}

async function ensureTangGallery(session: ActiveSession): Promise<OpenedMuseum> {
  if (session.state.gallery_id === DEFAULT_GALLERY_ID) return { active: session };
  const result = await enterGallery(session, DEFAULT_GALLERY_ID);
  if (result.receipt.status === "committed") return { active: result.session, receipt: result.receipt };
  if (result.session.state.gallery_id === DEFAULT_GALLERY_ID) return { active: result.session };
  throw new Error(result.receipt.reason ?? "未能进入唐朝展厅");
}

function modeLabel(mode: string): string {
  return ({ explore: "自由探索", story: "故事模式", qa: "问答模式", hypothesis: "假设模式" } as Record<string, string>)[mode] ?? mode;
}

function showError(
  reason: unknown,
  setMessage: (message: string) => void,
  setTone: (tone: "info" | "error" | "success") => void,
) {
  setMessage(reason instanceof Error ? reason.message : "操作未完成，请稍后重试。");
  setTone("error");
}
