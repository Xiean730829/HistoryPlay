import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Health = { status: "ok"; service: string };

function MuseumBootstrap() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`服务返回 ${response.status}`);
        return (await response.json()) as Health;
      })
      .then(setHealth)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "暂时无法连接服务");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="welcome-card">
      <p className="eyebrow">HISTORY PLAY · DEVELOPMENT BASELINE</p>
      <h1>时空博物馆</h1>
      <p className="intro">真实文物、历史故事与开放探索的数字展厅。</p>
      <div className={`service-status ${health ? "is-ready" : error ? "has-error" : ""}`} role="status">
        <span className="status-dot" />
        {health ? `${health.service} 已连接` : error ? `游戏服务未连接：${error}` : "正在连接本地游戏服务…"}
      </div>
      <p className="note">展厅内容与交互将在后续工作项中逐步接入。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MuseumBootstrap />
  </React.StrictMode>,
);
