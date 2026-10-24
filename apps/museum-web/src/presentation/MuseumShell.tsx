import React from "react";
import {
  createSession,
  restoreSession,
  searchArtifacts,
  openArtifact,
  unpairSession,
  type ActiveSession,
  type SessionCredentials,
  type SearchHit,
} from "../application/museumApi";
import { ExhibitList } from "./ExhibitList";
import { StatusNotice } from "./StatusNotice";
import { MuseumCorridor } from "../gallery/MuseumCorridor";

const SESSION_KEY = "history-play.session.v1";
const DEFAULT_PACK_ID = import.meta.env.VITE_MUSEUM_PACK_ID?.trim() || "cn.tang.core";
const DEFAULT_VERSION = import.meta.env.VITE_MUSEUM_PACK_VERSION?.trim() || "1.0.0";
const SHOW_DIAGNOSTICS = new URLSearchParams(window.location.search).get("debug") === "1";
type Health = { status: "ok"; service: string };

export function MuseumShell() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthError, setHealthError] = React.useState(false);
  const [session, setSession] = React.useState<ActiveSession | null>(null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("正在连接本地游戏服务…");
  const [noticeTone, setNoticeTone] = React.useState<"info" | "error" | "success">("info");
  const restoreTask = React.useRef<Promise<ActiveSession> | null>(null);

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
          .then((active) => {
            if (!current) return;
            setSession(active);
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
      const active = await openDefaultSession();
      restoreTask.current = Promise.resolve(active);
      setSession(active);
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
      setSession(result.session);
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
    <main className="museum-page">
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

      <StatusNotice message={notice} tone={noticeTone} />

      <MuseumCorridor
        artifacts={session?.context.visible_artifacts ?? []}
        displayOrder={session?.state.display_order ?? []}
        focusedId={session?.context.focused_artifact?.id ?? session?.state.focused_entity_id ?? null}
        loading={!session && !healthError}
      />

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

async function openDefaultSession(): Promise<ActiveSession> {
  const restored = await restoreSavedSession();
  if (restored) return restored;

  const credentials = await createSession(DEFAULT_PACK_ID, DEFAULT_VERSION);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
  return restoreSession(credentials);
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
