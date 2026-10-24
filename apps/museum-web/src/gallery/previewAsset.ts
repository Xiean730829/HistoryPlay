import type { ArtifactProjection } from "../application/museumApi";

/** Prefer explicit presentation binding; never treat the first asset_ids entry as preview. */
export function resolvePreviewAssetId(artifact: ArtifactProjection): string | null {
  const explicit = artifact.presentation?.preview_asset_id?.trim();
  if (explicit) return explicit;
  const named = artifact.asset_ids.find((id) => /\.preview$/u.test(id));
  return named ?? null;
}
