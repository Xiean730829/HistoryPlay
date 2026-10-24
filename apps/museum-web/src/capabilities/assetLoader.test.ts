import { describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./assetLoader";

function fixture(maxPreviewBytes = 8, maxModelBytes = 16) {
  const revoked: string[] = [];
  const fetchBlob = vi.fn(async (_session: typeof session, id: string) =>
    new Blob([id === "large" ? "123456789" : id]));
  const loader = new AssetLoader({
    maxPreviewBytes,
    maxModelBytes,
    fetchBlob,
    createObjectURL: (blob) => `blob:${blob.size}:${fetchBlob.mock.calls.length}`,
    revokeObjectURL: (url) => revoked.push(url),
    retryDelayMs: 0,
  });
  return { loader, fetchBlob, revoked };
}

const session = { session_id: "session-a", session_token: "secret" };
const signal = () => new AbortController().signal;

describe("展品资产加载", () => {
  it("卸载时释放引用，LRU只淘汰未使用资源并按预览/模型分别计量", async () => {
    const { loader, revoked } = fixture(1, 16);
    const a = await loader.acquire(session, "a", "preview", signal());
    a.release();
    const b = await loader.acquire(session, "b", "preview", signal());
    expect(revoked).toContain(a.url);
    expect(loader.snapshot()).toMatchObject({ preview: { bytes: 1, active: 1 }, model: { bytes: 0 } });
    const model = await loader.acquire(session, "model", "model", signal());
    expect(loader.snapshot()).toMatchObject({ preview: { bytes: 1 }, model: { bytes: 5, active: 1 } });
    b.release();
    model.release();
  });

  it("延迟网络返回晚于取消时丢弃响应，不创建或缓存对象URL", async () => {
    let finish!: (blob: Blob) => void;
    const createObjectURL = vi.fn(() => "blob:late");
    const delayed = new AssetLoader({
      fetchBlob: () => new Promise((resolve) => { finish = resolve; }),
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    const controller = new AbortController();
    const pending = delayed.acquire(session, "slow", "model", controller.signal);
    controller.abort();
    finish(new Blob(["late"]));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(delayed.snapshot().model.entries).toBe(0);
  });

  it("快速切换目标时迟到的A不会覆盖已载入的B", async () => {
    const completions = new Map<string, (blob: Blob) => void>();
    const urls: string[] = [];
    const loader = new AssetLoader({
      fetchBlob: (_boundSession, id) => new Promise((resolve) => { completions.set(id, resolve); }),
      createObjectURL: (blob) => `blob:${blob.size}:${urls.length}`,
      revokeObjectURL: (url) => urls.push(`revoked:${url}`),
    });
    const aController = new AbortController();
    const a = loader.acquire(session, "A", "model", aController.signal);
    const b = loader.acquire(session, "B", "model", signal());
    completions.get("B")?.(new Blob(["B"]));
    const leaseB = await b;
    aController.abort();
    completions.get("A")?.(new Blob(["A"]));
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(loader.snapshot().model).toMatchObject({ entries: 1, active: 1, bytes: 1 });
    leaseB.release();
    expect(urls).toEqual([]);
  });

  it("网络失败后只重试一次，超过独立预算时仅在释放时撤销临时URL", async () => {
    const { loader, fetchBlob, revoked } = fixture(2, 4);
    fetchBlob.mockRejectedValueOnce(new Error("慢网"));
    const oversized = await loader.acquire(session, "large", "model", signal());
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    expect(loader.snapshot().model).toMatchObject({ bytes: 9, active: 1, entries: 1 });
    oversized.release();
    expect(loader.snapshot().model).toMatchObject({ bytes: 0, active: 0, entries: 0 });
    expect(revoked).toContain(oversized.url);
  });

  it("模型只在焦点租约期间驻留，释放后立即回收且统计不残留", async () => {
    const { loader, revoked } = fixture(8, 0);
    for (let station = 0; station < 20; station += 1) {
      const model = await loader.acquire(session, `model-${station}`, "model", signal());
      expect(loader.snapshot().model.active).toBe(1);
      model.release();
      expect(loader.snapshot().model).toMatchObject({ entries: 0, active: 0, bytes: 0 });
      expect(revoked).toContain(model.url);
    }
  });

  it("相邻预取最多两个项目，租约可重复释放", async () => {
    const { loader, fetchBlob } = fixture();
    const leases = await loader.prefetchAdjacent(session, ["a", "b", "c"], signal());
    expect(leases).toHaveLength(2);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    leases[0].release();
    leases[0].release();
    leases[1].release();
  });
});
