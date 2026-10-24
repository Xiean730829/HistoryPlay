import type { ArtifactProjection, SearchHit } from "../application/museumApi";

interface ExhibitListProps {
  artifacts: ArtifactProjection[];
  focusedId: string | null;
  results: SearchHit[];
  busy: boolean;
  onOpen: (artifactId: string) => void;
}

export function ExhibitList({ artifacts, focusedId, results, busy, onOpen }: ExhibitListProps) {
  return (
    <div className="exhibit-columns">
      <section className="exhibit-section" aria-labelledby="opened-heading">
        <div className="section-heading">
          <div>
            <p className="section-kicker">展厅现场</p>
            <h2 id="opened-heading">已开放展品</h2>
          </div>
          <span className="count-pill">{artifacts.length} 件</span>
        </div>
        {artifacts.length === 0 ? (
          <p className="empty-state">展厅还没有展品。搜索内容后，选择一件文物放入展厅。</p>
        ) : (
          <ol className="opened-list">
            {artifacts.map((artifact, index) => (
              <li className={artifact.id === focusedId ? "is-current" : ""} key={artifact.id}>
                <span className="order-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{artifact.title}</strong>
                  <span className="artifact-meta">
                    {artifact.time_range.display_label ?? `${artifact.time_range.start_year} 年`} · {artifact.material} · {artifact.category}
                  </span>
                </div>
                {artifact.id === focusedId && <span className="current-label">当前焦点</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="exhibit-section" aria-labelledby="results-heading">
        <div className="section-heading">
          <div>
            <p className="section-kicker">固定版本目录</p>
            <h2 id="results-heading">搜索结果</h2>
          </div>
          <span className="count-pill">{results.length} 件</span>
        </div>
        {results.length === 0 ? (
          <p className="empty-state">输入展品名称或别名，查看当前会话固定版本中的文物。</p>
        ) : (
          <ul className="search-results">
            {results.map((item) => {
              const opened = artifacts.some((artifact) => artifact.id === item.id);
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span className="artifact-meta">{item.summary || item.id}</span>
                  </div>
                  <button
                    className="button button-small"
                    disabled={busy || opened}
                    onClick={() => onOpen(item.id)}
                    type="button"
                  >
                    {opened ? "已开放" : "放入展厅"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
