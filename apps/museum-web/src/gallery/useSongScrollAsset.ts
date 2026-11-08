import React from "react";
import { AssetLoader, type AssetLease } from "../capabilities/assetLoader";
import { loadSessionAssetBlob, type ActiveSession } from "../application/museumApi";

/** Separate scroll budget; unmounting a Song canvas never clears Tang model leases. */
const scrollAssets = new AssetLoader({
  maxPreviewBytes: 8 * 1024 * 1024, maxPreviewAssetBytes: 8 * 1024 * 1024,
  maxModelBytes: 0, fetchBlob: loadSessionAssetBlob,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});

export function useSongScrollAsset(session: ActiveSession, assetId: string | undefined, retry: number) {
  const scope = `${session.session_id}:${session.connection_id}:${session.pack_id}:${session.version}:${assetId}:${retry}`;
  const [loaded, setLoaded] = React.useState<{ scope: string; url: string | null; error: string | null } | null>(null);
  React.useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    let lease: AssetLease | null = null;
    void scrollAssets.acquire(session, assetId, "preview", controller.signal).then((next) => {
      if (controller.signal.aborted) { next.release(); return; }
      lease = next;
      setLoaded({ scope, url: next.url, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoaded({ scope, url: null,
        error: error instanceof Error ? error.message : "画卷资源不可用" });
    });
    return () => { controller.abort(); lease?.release(); };
  }, [scope]);
  return loaded?.scope === scope ? loaded : { scope, url: null, error: null };
}
