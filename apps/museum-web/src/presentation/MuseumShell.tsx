import React from "react";
import type { CommandReceipt } from "@history-play/contracts";
import {
  createSession,
  restoreSession,
  searchArtifacts,
  openArtifact,
  moveGalleryStation,
  browseGalleryWindow,
  seekGalleryTimeRange,
  enterGallery,
  unpairSession,
  requestEventTicket,
  refreshSession,
  loadGalleryArtifacts,
  loadGalleryDocument,
  type GalleryDocument,
  enterStory,
  continueStory,
  chooseStoryRoute,
  returnToExhibit,
  reportRenderReceipt,
  prepareArtifactInspection,
  setArtifactView,
  type ActiveSession,
  type ArtifactProjection,
  type SessionCredentials,
  type SearchHit,
} from "../application/museumApi";
import { restoreOrDiscardExpiredSession } from "../application/sessionRecovery";
import { EventChannel } from "../api/eventChannel";
import { SessionProjectionStore } from "../state/sessionProjection";
import { ExhibitList } from "./ExhibitList";
import { StatusNotice } from "./StatusNotice";
import { MuseumSpace } from "../scene3d/MuseumSpace";
import { GameVoicePanel } from "../voice-ui/GameVoicePanel";
import { ArtifactStoryStage } from "../story/ArtifactStoryStage";
import { RenderReceiptReporter } from "../capabilities/RenderReceiptReporter";
import { isMuseumEntryConsent } from "./entryConsent";
import { applyEntranceIntent, ERA_CLARIFY_SPEECH, selectEraFromEntrance } from "./eraSelection";
import { galleryWindowBounds, galleryWindowLabel as formatGalleryWindow } from "../gallery/galleryWindow";
import { isRenderGatedAction } from "../voice/renderGatedActions";
import { voiceTrace } from "../voice/VoiceTrace";
import type { EraDefinition, EraId } from "./eraRegistry";
import { SongScrollGallery } from "../gallery/SongScrollGallery";
import { SongExhibitPage } from "../gallery/SongExhibitPage";
import "./museum-portal.css";

const SESSION_KEY = "history-play.session.v1";
const DEFAULT_PACK_ID = import.meta.env.VITE_MUSEUM_PACK_ID?.trim() || "cn.tang.core";
const DEFAULT_VERSION = import.meta.env.VITE_MUSEUM_PACK_VERSION?.trim() || "0.2.4";
const DEFAULT_GALLERY_ID =
  import.meta.env.VITE_MUSEUM_GALLERY_ID?.trim() || "cn.tang.gallery.main";
const SHOW_DIAGNOSTICS = new URLSearchParams(window.location.search).get("debug") === "1";
type Health = { status: "ok"; service: string };
type OpenedMuseum = {
  active: ActiveSession;
  receipt?: CommandReceipt;
  recoveredExpiredSession?: boolean;
};

export function MuseumShell({ preparedSession, era, onChangeEra, onSelectEra,
  autoStartVoice = false, initialVoiceMode = "gate", onVoiceActiveChange, onVoiceModeChange }: {
  preparedSession?: ActiveSession;
  era?: EraDefinition;
  onChangeEra?: () => void;
  onSelectEra?: (era: EraId) => void;
  autoStartVoice?: boolean;
  initialVoiceMode?: "gate" | "manual";
  onVoiceActiveChange?: (active: boolean) => void;
  onVoiceModeChange?: (mode: "gate" | "manual") => void;
} = {}) {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthError, setHealthError] = React.useState(false);
  const [session, setSession] = React.useState<ActiveSession | null>(preparedSession ?? null);
  const [renderCommand, setRenderCommand] = React.useState<CommandReceipt | null>(null);
  const isSong = era?.presentation === "song_scroll";
  const [songGallery, setSongGallery] = React.useState<GalleryDocument | null>(null);
  const [galleryArtifacts, setGalleryArtifacts] = React.useState<ArtifactProjection[]>([]);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [inspection, setInspection] = React.useState(false);
  const [portalOpen, setPortalOpen] = React.useState(!preparedSession);
  const portalOpenRef = React.useRef(portalOpen);
  portalOpenRef.current = portalOpen;
  const entryOpeningRef = React.useRef(false);
  const [entryStatusVisible, setEntryStatusVisible] = React.useState(false);
  const [voiceDrivenStory, setVoiceDrivenStory] = React.useState(false);
  const [notice, setNotice] = React.useState("正在连接本地游戏服务…");
  const [noticeTone, setNoticeTone] = React.useState<"info" | "error" | "success">("info");
  const restoreTask = React.useRef<Promise<OpenedMuseum> | null>(null);
  const projectionStore = React.useRef<SessionProjectionStore | null>(null);
  const renderReporter = React.useRef(new RenderReceiptReporter(reportRenderReceipt));
  const voiceRenderWaiters = React.useRef(new Map<string, {
    resolve: (status: "rendered" | "degraded" | "pending") => void;
    timeout: ReturnType<typeof setTimeout>;
  }>());
  const localPresentationWaiter = React.useRef<{
    armed: boolean;
    resolve: (status: "rendered" | "degraded" | "pending") => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const voiceGuide = React.useRef<{
    noteClickInspection(artifactId: string, revision: number): Promise<void>;
    pauseNarration(): void;
    speakPrompt(text: string): Promise<void>;
  } | null>(null);

  function settleVoiceRender(requestId: string, status: "rendered" | "degraded" | "pending") {
    const waiter = voiceRenderWaiters.current.get(requestId);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    voiceRenderWaiters.current.delete(requestId);
    waiter.resolve(status);
  }

  function cancelVoiceRenderWaiters() {
    const pendingIds = [...voiceRenderWaiters.current.keys()];
    for (const requestId of pendingIds) settleVoiceRender(requestId, "pending");
    if (localPresentationWaiter.current) {
      clearTimeout(localPresentationWaiter.current.timeout);
      localPresentationWaiter.current.resolve("pending");
      localPresentationWaiter.current = null;
    }
    if (pendingIds.length) {
      voiceTrace.record("render", {
        cancelled: true,
        reason: "render_superseded",
        pending: pendingIds.length,
      });
    }
  }

  React.useEffect(() => () => {
    cancelVoiceRenderWaiters();
    if (localPresentationWaiter.current) {
      clearTimeout(localPresentationWaiter.current.timeout);
      localPresentationWaiter.current.resolve("pending");
      localPresentationWaiter.current = null;
    }
  }, []);

  async function applyVoicePresentation(action: "focus_current" | "return_to_overview") {
    if (localPresentationWaiter.current) {
      clearTimeout(localPresentationWaiter.current.timeout);
      localPresentationWaiter.current.resolve("pending");
    }
    let resolveWaiter!: (status: "rendered" | "degraded" | "pending") => void;
    const rendered = new Promise<"rendered" | "degraded" | "pending">((resolve) => { resolveWaiter = resolve; });
    const waiter = {
      armed: false,
      resolve: resolveWaiter,
      timeout: setTimeout(() => {
        if (localPresentationWaiter.current === waiter) {
          localPresentationWaiter.current = null;
          resolveWaiter("pending");
        }
      }, 9000),
    };
    localPresentationWaiter.current = waiter;
    setInspection(action === "focus_current");
    if (action === "return_to_overview") setVoiceDrivenStory(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (localPresentationWaiter.current !== waiter) return rendered;
    waiter.armed = true;
    return rendered;
  }

  React.useEffect(() => {
    if (portalOpen || !entryOpeningRef.current) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const door = document.querySelector(".museum-entry-door");
        const canvas = document.querySelector<HTMLCanvasElement>(".museum-space .museum-webgl canvas");
        const bounds = canvas?.getBoundingClientRect();
        entryOpeningRef.current = false;
        if (!door && canvas && bounds && bounds.width > 0 && bounds.height > 0) {
          setNotice("展厅画面已打开，可以开始参观。");
          setNoticeTone("success");
        } else {
          portalOpenRef.current = true;
          setPortalOpen(true);
          setNotice("已听到入馆请求，但展厅画面未能显示；请检查 WebGL 或稍后重试。");
          setNoticeTone("error");
        }
      });
    });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame); };
  }, [portalOpen, session?.session_id]);

  // Inspection/overview is chosen by committed command handlers, not by a
  // generic focus-change effect: browsing changes focus while staying far away.

  async function enterHallFromPortal() {
    if (!portalOpenRef.current) return;
    setEntryStatusVisible(true);
    setNotice("已听到入馆请求，正在打开展厅画面…");
    setNoticeTone("info");
    setInspection(false);
    setVoiceDrivenStory(false);
    const current = projectionStore.current?.snapshot ?? session;
    if (current && current.state.mode !== "explore") {
      try {
        const result = await returnToExhibit(current);
        const store = projectionStore.current;
        if (store) await store.acceptQuery(result.session);
        else setSession(result.session);
        setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
        setInspection(false);
      } catch (error) {
        showError(error, setNotice, setNoticeTone);
        return;
      }
    }
    if (!portalOpenRef.current) return;
    portalOpenRef.current = false;
    entryOpeningRef.current = true;
    setPortalOpen(false);
  }

  async function selectExhibit(id: string) {
    if (!session || busy || session.state.mode !== "explore") return;
    cancelVoiceRenderWaiters();
    const current = projectionStore.current?.snapshot ?? session;
    setBusy(true);
    try {
      const result = await prepareArtifactInspection(current, id);
      if (projectionStore.current) await projectionStore.current.acceptQuery(result.session);
      else setSession(result.session);
      if (result.receipt?.status === "committed") setRenderCommand(result.receipt);
      if (result.session.state.focused_entity_id === id) {
        setInspection(true);
        if (!isSong) void voiceGuide.current?.noteClickInspection(id, result.session.state.revision);
      }
      else throw new Error(result.receipt?.reason ?? "暂时无法走近这件文物");
    } catch (error) { showError(error, setNotice, setNoticeTone); }
    finally { setBusy(false); }
  }

  async function observeExhibit(deltaYaw: number, deltaPitch: number, zoomFactor: number) {
    if (!session || busy || session.state.mode !== "explore") return;
    cancelVoiceRenderWaiters();
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
    const controller = new AbortController();
    setGalleryArtifacts([]);
    setSongGallery(null);
    if (!session?.state.gallery_id) return () => controller.abort();
    if (isSong) {
      void loadGalleryDocument(session, session.state.gallery_id, controller.signal)
        .then((gallery) => { if (!controller.signal.aborted) setSongGallery(gallery); })
        .catch((error: unknown) => { if (!controller.signal.aborted) showError(error, setNotice, setNoticeTone); });
      return () => controller.abort();
    }
    void loadGalleryArtifacts(session, session.state.gallery_id, controller.signal)
      .then((artifacts) => { if (!controller.signal.aborted) setGalleryArtifacts(artifacts); })
      .catch((error: unknown) => { if (!controller.signal.aborted) showError(error, setNotice, setNoticeTone); });
    return () => controller.abort();
  }, [session?.session_id, session?.connection_id, session?.state.gallery_id, isSong]);

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
        if (preparedSession) {
          setNotice(`${era?.title ?? "所选展厅"}会话已准备；画面和语音状态分别以实际加载结果为准。`);
          return;
        }
        restoreTask.current ??= openDefaultSession();
        restoreTask.current
          .then(({ active, receipt, recoveredExpiredSession }) => {
            if (!current) return;
            setSession(active);
            setRenderCommand(receipt ?? null);
            setNotice(recoveredExpiredSession
              ? "检测到旧展厅会话已失效，已自动重新进入博物馆。"
              : "已进入唐朝长廊。文物顺序与年代由当前发布版本和服务端状态决定。");
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
      setNotice(opened.recoveredExpiredSession
        ? "检测到旧展厅会话已失效，已自动重新进入博物馆。"
        : "已进入唐朝长廊。文物顺序与年代由当前发布版本和服务端状态决定。");
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
    cancelVoiceRenderWaiters();
    setRenderCommand(null);
    setBusy(true);
    try {
      const result = await moveGalleryStation(session, direction);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setInspection(true);
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

  async function browseWindow(direction: "next" | "previous") {
    if (!session) return;
    cancelVoiceRenderWaiters();
    setRenderCommand(null);
    setBusy(true);
    try {
      const result = await browseGalleryWindow(session, direction);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setInspection(false);
        const view = result.session.state.gallery_view;
        const total = result.session.state.display_order.length;
        setNotice(isSong
          ? `已转到${formatGalleryWindow(total, view?.window_start ?? 0, view?.page_size ?? 3)}，仍在画卷总览。`
          : `已转到第 ${(view?.window_start ?? 0) + 1}—${Math.min((view?.window_start ?? 0) + (view?.page_size ?? 4), total)} 件，仍在总览。`);
        setNoticeTone("success");
      } else {
        setNotice(result.receipt.reason ?? "已经到达当前展廊边界，位置保持不变。");
        setNoticeTone("error");
      }
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function clearTimeFilter() {
    if (!session) return;
    cancelVoiceRenderWaiters();
    setBusy(true);
    try {
      const result = await seekGalleryTimeRange(session, { clear: true });
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        setInspection(false);
        setNotice("已清除时间筛选，正在看全部唐朝文物。");
        setNoticeTone("success");
      } else {
        setNotice(result.receipt.reason ?? "时间筛选未改变。");
        setNoticeTone("error");
      }
    } catch (error) {
      showError(error, setNotice, setNoticeTone);
    } finally {
      setBusy(false);
    }
  }

  async function runStoryAction(action: "enter" | "continue" | "choose_route" | "return", targetNodeId?: string) {
    if (!session) return;
    cancelVoiceRenderWaiters();
    const focused = session.context.focused_artifact;
    setVoiceDrivenStory(false);
    const storyId = focused?.story_entry_ids?.[0];
    if (action === "enter" && !storyId) return;
    if (action === "choose_route" && !targetNodeId) return;
    setBusy(true);
    try {
      const result = action === "enter"
        ? await enterStory(session, storyId!)
        : action === "continue"
          ? await continueStory(session)
          : action === "choose_route"
            ? await chooseStoryRoute(session, targetNodeId!)
            : await returnToExhibit(session);
      const store = projectionStore.current;
      if (store) await store.acceptQuery(result.session);
      else setSession(result.session);
      setRenderCommand(result.receipt.status === "committed" ? result.receipt : null);
      if (result.receipt.status === "committed") {
        if (action === "return" && isSong) setInspection(false);
        setNotice(action === "return"
          ? (isSong ? "故事已退出，正在返回同一画卷。" : "故事已退出，正在恢复原展台与相机。")
          : action === "choose_route"
            ? "已按所选方向进入下一段。"
            : "已切换到服务端提交的故事段落。");
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
    cancelVoiceRenderWaiters();
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
    <main className={`museum-page ${isSong ? "museum-page-song" : "museum-page-spatial"}`} data-story-mode={!portalOpen && session?.state.mode === "story" ? "true" : undefined}>
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

      {portalOpen && <section className="museum-entry-door" aria-label="时空博物馆入口">
        <div className="museum-entry-copy">
          <p className="museum-entry-kicker">唐代特展 · 星河寻珍</p>
          <h2>时空博物馆</h2>
          <p>循着时间长河，走进一座真正的博物馆。</p>
          <span>{session
            ? "浏览器需要你点击一次并允许麦克风；随后小智会先向你问候，说“可以”即可进入展厅。"
            : noticeTone === "error" ? notice : healthError ? "展厅暂未连接，请重试本地展厅服务。" : "正在准备展厅入口…"}</span>
          {!session && (healthError || noticeTone === "error") && <button className="museum-entry-retry" disabled={busy}
            onClick={() => void startMuseum()} type="button">{busy ? "正在重试…" : "重试连接"}</button>}
        </div>
      </section>}

      {onChangeEra && <button className="era-change-button" type="button" disabled={busy}
        onClick={() => {
          cancelVoiceRenderWaiters();
          voiceGuide.current?.pauseNarration();
          onChangeEra();
        }}>暂停并选择朝代</button>}
      {(noticeTone === "error" || entryStatusVisible || SHOW_DIAGNOSTICS) && <StatusNotice message={notice} tone={noticeTone} />}

      {session && !isSong && <MuseumSpace
        artifacts={galleryArtifacts.length ? galleryArtifacts : session.context.visible_artifacts}
        session={session}
        inspection={inspection}
        onSelect={(id) => void selectExhibit(id)}
        onObserve={(yaw, pitch, zoom) => void observeExhibit(yaw, pitch, zoom)}
        onRender={(status, reason) => {
          const localPresentation = localPresentationWaiter.current;
          if (localPresentation) {
            if (localPresentation.armed) {
              clearTimeout(localPresentation.timeout);
              localPresentationWaiter.current = null;
              localPresentation.resolve(status);
            }
            return;
          }
          if (session.state.mode === "explore") {
            void renderReporter.current.report(session, renderCommand, status, reason)
              .then((reported) => {
                if (reported && renderCommand) settleVoiceRender(renderCommand.request_id, status);
              }).catch(() => undefined);
          }
        }}
      />}
      {isSong && session?.state.mode === "explore" && (inspection && session.context.focused_artifact
        ? <SongExhibitPage key={`${session.session_id}:${session.connection_id}:${session.context.focused_artifact.id}`}
            artifact={session.context.focused_artifact} session={session} busy={busy}
            onReturn={() => { cancelVoiceRenderWaiters(); setInspection(false); }}
            onStory={() => void runStoryAction("enter")}
            onRender={(status, reason) => {
              const local = localPresentationWaiter.current;
              if (local?.armed) {
                clearTimeout(local.timeout); localPresentationWaiter.current = null; local.resolve(status);
              }
              void renderReporter.current.report(session, renderCommand, status, reason)
                .then((reported) => { if (reported && renderCommand) settleVoiceRender(renderCommand.request_id, status); })
                .catch(() => undefined);
              if (status === "rendered") void voiceGuide.current?.noteClickInspection(
                session.context.focused_artifact!.id, session.state.revision,
              );
            }} />
        : songGallery ? <SongScrollGallery session={session} gallery={songGallery} busy={busy}
            onSelect={(id) => void selectExhibit(id)} onRender={(status, reason) => {
              const local = localPresentationWaiter.current;
              if (local?.armed) {
                clearTimeout(local.timeout); localPresentationWaiter.current = null; local.resolve(status);
              }
              void renderReporter.current.report(session, renderCommand, status, reason)
                .then((reported) => { if (reported && renderCommand) settleVoiceRender(renderCommand.request_id, status); })
                .catch(() => undefined);
            }} /> : <p role="status">正在读取当前发布包的宋代画卷资料…</p>)}
      {session?.state.mode === "story" && !portalOpen && (
        <ArtifactStoryStage
          session={session}
          busy={busy}
          voiceDriven={voiceDrivenStory}
          onContinue={() => void runStoryAction("continue")}
          onChooseRoute={(targetNodeId) => void runStoryAction("choose_route", targetNodeId)}
          onReturn={() => void runStoryAction("return")}
        />
      )}

      {!isSong && session?.state.mode === "explore" && inspection && session.context.focused_artifact?.story_entry_ids?.length ? (
        <div className="story-entry-row" aria-label={`${session.context.focused_artifact.title}的故事入口`}>
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

      {session?.state.mode === "explore" && !isSong && <nav className="museum-walk-controls" aria-label="横向展廊翻看">
        <button disabled={busy || !galleryWindowState(session).hasPrevious} onClick={() => void browseWindow("previous")} type="button">{isSong ? "上一卷" : "上一组"}</button>
        <button disabled={busy} onClick={() => void moveStation("previous")} type="button">上一件</button>
        <span>{inspection ? (session.context.focused_artifact?.title ?? "大唐文物") : galleryWindowLabel(session)}</span>
        <button disabled={busy} onClick={() => void moveStation("next")} type="button">下一件</button>
        <button disabled={busy || !galleryWindowState(session).hasNext} onClick={() => void browseWindow("next")} type="button">{isSong ? "下一卷" : "下一组"}</button>
      </nav>}
      {isSong && session?.state.mode === "explore" && !inspection && <nav className="song-scroll-navigation" aria-label="宋代画卷翻页">
        <button disabled={busy || !galleryWindowState(session).hasPrevious} onClick={() => void browseWindow("previous")} type="button">上一卷</button>
        <span>{galleryWindowLabel(session)}</span>
        <button disabled={busy || !galleryWindowState(session).hasNext} onClick={() => void browseWindow("next")} type="button">下一卷</button>
      </nav>}
      {session?.state.mode === "explore" && session.state.gallery_view?.time_filter && (
        <div className="museum-time-filter" aria-label="当前时间筛选">
          <span>筛选 {session.state.gallery_view.time_filter.start_year}—{session.state.gallery_view.time_filter.end_year} 年</span>
          <button disabled={busy} onClick={() => void clearTimeFilter()} type="button">清除筛选</button>
        </div>
      )}

      {session && (
        <GameVoicePanel
          key={`${session.session_id}:${session.connection_id}`}
          session={session}
          autoStart={autoStartVoice}
          initialMode={initialVoiceMode}
          onActiveChange={onVoiceActiveChange}
          onModeChange={onVoiceModeChange}
          portalActive={portalOpen}
          welcomeOnConnect={portalOpen}
          gameUrl={import.meta.env.VITE_MUSEUM_GAME_URL?.trim() || "http://127.0.0.1:8793"}
          bridgeUrl={import.meta.env.VITE_MUSEUM_BRIDGE_URL?.trim() || window.location.origin}
          onUserTranscript={(text) => {
            if (onSelectEra && applyEntranceIntent(text, (next) => {
              cancelVoiceRenderWaiters();
              voiceGuide.current?.pauseNarration();
              onSelectEra(next);
            }, () => {
              setNotice(ERA_CLARIFY_SPEECH);
              setNoticeTone("info");
              setEntryStatusVisible(true);
              void voiceGuide.current?.speakPrompt(ERA_CLARIFY_SPEECH);
            })) return;
            if (portalOpenRef.current) {
              const intent = selectEraFromEntrance(text);
              if (intent.kind === "selected" && intent.era === "tang") {
                void enterHallFromPortal();
                return;
              }
              if (intent.kind === "selected" && intent.era === "song") {
                setNotice("宋代展厅目前只在候选入口开放，默认入口仍是唐代。");
                setNoticeTone("info");
                setEntryStatusVisible(true);
                return;
              }
            }
            if (portalOpenRef.current && isMuseumEntryConsent(text)) void enterHallFromPortal();
          }}
          onNewInput={cancelVoiceRenderWaiters}
          onStoryTransition={(action) => {
            if (portalOpenRef.current || entryOpeningRef.current) return;
            const returning = ["return_to_exhibit", "return_to_overview"].includes(action);
            setVoiceDrivenStory(!returning);
            if (returning) setInspection(false);
          }}
          onRefresh={async (receipt) => {
            if (receipt?.status === "committed" && receipt.action === "return_to_exhibit") {
              setVoiceDrivenStory(false);
              setInspection(false);
            }
            if ((portalOpenRef.current || entryOpeningRef.current) && receipt?.status === "committed"
              && ["enter_story", "continue_story"].includes(receipt.action ?? "")) {
              try {
                const latest = await refreshSession(projectionStore.current?.snapshot ?? session);
                if (latest.state.mode !== "explore") {
                  const restored = await returnToExhibit(latest);
                  const store = projectionStore.current;
                  if (store) await store.acceptQuery(restored.session);
                  else setSession(restored.session);
                  setInspection(false);
                }
              } catch { /* Keep opening the hall even if a stray story command cannot be undone. */ }
              return "pending";
            }
            if (receipt?.status === "committed" && ["enter_story", "continue_story"].includes(receipt.action ?? "")) setVoiceDrivenStory(true);
            if (receipt?.status === "committed" && receipt.action === "return_to_exhibit") setVoiceDrivenStory(false);
            const expectsRenderedFrame = receipt?.status === "committed"
              && isRenderGatedAction(receipt.action ?? "");
            let rendered: Promise<"rendered" | "degraded" | "pending"> | null = null;
            if (expectsRenderedFrame && receipt) {
              rendered = new Promise((resolve) => {
                const timeout = setTimeout(() => settleVoiceRender(receipt.request_id, "pending"), 9000);
                voiceRenderWaiters.current.set(receipt.request_id, { resolve, timeout });
              });
            }
            try {
              const active = await refreshSession(session);
              const store = projectionStore.current;
              if (store) await store.acceptQuery(active);
              else setSession(active);
              if (receipt?.status === "committed" && receipt.action === "return_to_exhibit") setInspection(false);
              setRenderCommand(receipt?.status === "committed" ? receipt : null);
              if (receipt?.status === "committed" && ["locate_artifact", "move_next", "move_previous", "set_view"].includes(receipt.action ?? "")) setInspection(true);
              if (receipt?.status === "committed" && ["browse_gallery", "seek_time_range"].includes(receipt.action ?? "")) setInspection(false);
              return rendered ? await rendered : "pending";
            } catch (error) {
              if (receipt) settleVoiceRender(receipt.request_id, "degraded");
              throw error;
            }
          }}
          onPresentation={applyVoicePresentation}
          onReady={(api) => { voiceGuide.current = api; }}
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

async function restoreSavedSession(): Promise<{
  session: ActiveSession | null;
  discardedExpiredCredential: boolean;
}> {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) return { session: null, discardedExpiredCredential: false };
  let credentials: SessionCredentials;
  try {
    credentials = JSON.parse(saved) as SessionCredentials;
    if (!credentials.session_id || !credentials.session_token) throw new Error("本地会话数据无效");
    if (credentials.pack_id !== DEFAULT_PACK_ID || credentials.version !== DEFAULT_VERSION) {
      sessionStorage.removeItem(SESSION_KEY);
      return { session: null, discardedExpiredCredential: true };
    }
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return { session: null, discardedExpiredCredential: true };
  }
  return restoreOrDiscardExpiredSession(
    () => restoreSession(credentials),
    () => sessionStorage.removeItem(SESSION_KEY),
  );
}

async function openDefaultSession(): Promise<OpenedMuseum> {
  const restored = await restoreSavedSession();
  if (restored.session) {
    return {
      ...await ensureTangGallery(restored.session),
      recoveredExpiredSession: restored.discardedExpiredCredential,
    };
  }

  const credentials = await createSession(DEFAULT_PACK_ID, DEFAULT_VERSION);
  const active = await restoreSession(credentials);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
  return {
    ...await ensureTangGallery(active),
    recoveredExpiredSession: restored.discardedExpiredCredential,
  };
}

async function ensureTangGallery(session: ActiveSession): Promise<OpenedMuseum> {
  if (session.state.gallery_id === DEFAULT_GALLERY_ID) return { active: session };
  const result = await enterGallery(session, DEFAULT_GALLERY_ID);
  if (result.receipt.status === "committed") return { active: result.session, receipt: result.receipt };
  if (result.session.state.gallery_id === DEFAULT_GALLERY_ID) return { active: result.session };
  throw new Error(result.receipt.reason ?? "未能进入唐朝展厅");
}

function galleryWindowState(session: ActiveSession) {
  return galleryWindowBounds(
    session.state.display_order.length,
    session.state.gallery_view?.window_start ?? 0,
    session.state.gallery_view?.page_size ?? 4,
  );
}

function galleryWindowLabel(session: ActiveSession): string {
  return formatGalleryWindow(
    session.state.display_order.length,
    session.state.gallery_view?.window_start ?? 0,
    session.state.gallery_view?.page_size ?? 4,
  );
}

function modeLabel(mode: string): string {
  return ({ explore: "自由探索", story: "故事模式", qa: "问答模式", hypothesis: "假设模式" } as Record<string, string>)[mode] ?? mode;
}

function showError(
  reason: unknown,
  setMessage: (message: string) => void,
  setTone: (tone: "info" | "error" | "success") => void,
) {
  const networkFailure = reason instanceof TypeError && /fetch/i.test(reason.message);
  const bindingFailure = reason instanceof Error && /绑定已失效|未绑定或已被新的配对替代/.test(reason.message);
  setMessage(networkFailure
    ? "本地展厅请求失败。刷新页面可清除旧会话；若仍失败，请确认本机游戏服务正在运行。"
    : bindingFailure
      ? "展台绑定已失效，请在当前页面重新开启语音后再试。这不是文物缺少资料。"
      : reason instanceof Error ? reason.message : "操作未完成，请稍后重试。");
  setTone("error");
}
