export type GalleryAssetKind = "preview" | "model";

export interface AssetSession {
  session_id: string;
  session_token: string;
}

export interface AssetLease {
  url: string;
  release(): void;
}

export interface AssetLoaderOptions {
  maxPreviewBytes?: number;
  maxModelBytes?: number;
  maxPreviewAssetBytes?: number;
  maxModelAssetBytes?: number;
  fetchBlob(session: AssetSession, assetId: string, signal: AbortSignal): Promise<Blob>;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  retryDelayMs?: number;
}

interface Entry {
  url: string;
  size: number;
  refs: number;
  touched: number;
}

/** Bounded object-URL cache with independent budgets for posters and GLBs. */
export class AssetLoader {
  private readonly entries: Record<GalleryAssetKind, Map<string, Entry>> = {
    preview: new Map(),
    model: new Map(),
  };
  private readonly budgets: Record<GalleryAssetKind, number>;
  private readonly assetLimits: Record<GalleryAssetKind, number>;
  private readonly live = new Map<string, { kind: GalleryAssetKind; size: number }>();
  private tick = 0;

  constructor(private readonly options: AssetLoaderOptions) {
    this.budgets = {
      preview: Math.max(0, options.maxPreviewBytes ?? 12 * 1024 * 1024),
      model: Math.max(0, options.maxModelBytes ?? 128 * 1024 * 1024),
    };
    this.assetLimits = {
      preview: Math.max(0, options.maxPreviewAssetBytes ?? 12 * 1024 * 1024),
      model: Math.max(0, options.maxModelAssetBytes ?? 128 * 1024 * 1024),
    };
  }

  async acquire(
    session: AssetSession,
    assetId: string,
    kind: GalleryAssetKind,
    signal: AbortSignal,
  ): Promise<AssetLease> {
    if (signal.aborted) throw abortError();
    const key = `${session.session_id}:${assetId}`;
    const cache = this.entries[kind];
    const existing = cache.get(key);
    if (existing) return this.lease(kind, key, existing);

    let blob: Blob | undefined;
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal.aborted) throw abortError();
      try {
        blob = await this.options.fetchBlob(session, assetId, signal);
        break;
      } catch (error) {
        if (signal.aborted || attempt === attempts - 1) throw error;
        await delay(this.options.retryDelayMs ?? 200, signal);
      }
    }
    if (signal.aborted) throw abortError();
    if (!blob) throw new Error("展品资源载入失败");
    const concurrent = cache.get(key);
    if (concurrent) return this.lease(kind, key, concurrent);

    const size = blob.size;
    const budget = this.budgets[kind];
    if (size > this.assetLimits[kind]) throw new Error("展品资源超过本机安全载入上限");
    if (size > budget || !this.makeRoom(kind, size)) {
      const url = this.options.createObjectURL(blob);
      this.live.set(url, { kind, size });
      let released = false;
      return {
        url,
        release: () => {
          if (released) return;
          released = true;
          if (this.live.delete(url)) this.options.revokeObjectURL(url);
        },
      };
    }

    const entry: Entry = {
      url: this.options.createObjectURL(blob), size, refs: 0, touched: ++this.tick,
    };
    cache.set(key, entry);
    return this.lease(kind, key, entry);
  }

  /** Prefetch is capped to two adjacent previews; callers release each lease. */
  prefetchAdjacent(
    session: AssetSession,
    assetIds: readonly string[],
    signal: AbortSignal,
  ): Promise<AssetLease[]> {
    return Promise.allSettled(assetIds.slice(0, 2).map((id) =>
      this.acquire(session, id, "preview", signal)))
      .then((results) => {
        const leases = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (signal.aborted) {
          leases.forEach((lease) => lease.release());
          throw abortError();
        }
        return leases;
      });
  }

  snapshot(): Record<GalleryAssetKind, { bytes: number; entries: number; active: number }> {
    const report = (kind: GalleryAssetKind) => {
      const entries = [...this.entries[kind].values()];
      const transient = [...this.live.values()].filter((entry) => entry.kind === kind);
      return {
        bytes: entries.reduce((sum, entry) => sum + entry.size, 0)
          + transient.reduce((sum, entry) => sum + entry.size, 0),
        entries: entries.length + transient.length,
        active: entries.filter((entry) => entry.refs > 0).length + transient.length,
      };
    };
    return { preview: report("preview"), model: report("model") };
  }

  dispose(): void {
    for (const cache of Object.values(this.entries)) {
      for (const entry of cache.values()) this.options.revokeObjectURL(entry.url);
      cache.clear();
    }
    for (const url of this.live.keys()) this.options.revokeObjectURL(url);
    this.live.clear();
  }

  private makeRoom(kind: GalleryAssetKind, incomingBytes: number): boolean {
    const cache = this.entries[kind];
    const budget = this.budgets[kind];
    let used = [...cache.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (used + incomingBytes > budget) {
      const victim = [...cache.entries()]
        .filter(([, entry]) => entry.refs === 0)
        .sort((a, b) => a[1].touched - b[1].touched)[0];
      if (!victim) return false;
      cache.delete(victim[0]);
      used -= victim[1].size;
      this.options.revokeObjectURL(victim[1].url);
    }
    return true;
  }

  private lease(kind: GalleryAssetKind, key: string, entry: Entry): AssetLease {
    entry.refs += 1;
    entry.touched = ++this.tick;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        entry.touched = ++this.tick;
        if (this.budgets[kind] === 0 && this.entries[kind].delete(key)) {
          this.options.revokeObjectURL(entry.url);
        }
      },
    };
  }
}

function abortError(): DOMException {
  return new DOMException("展品资源载入已取消", "AbortError");
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, Math.max(0, milliseconds));
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
