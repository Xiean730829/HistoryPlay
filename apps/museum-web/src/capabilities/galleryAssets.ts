import { loadSessionAssetBlob } from "../application/museumApi";
import { AssetLoader } from "./assetLoader";

/** Visible corridor window is 3 neighbors max; only its poster assets are prefetched. */
export const galleryAssets = new AssetLoader({
  maxPreviewBytes: 12 * 1024 * 1024,
  maxModelBytes: 0,
  maxModelAssetBytes: 128 * 1024 * 1024,
  fetchBlob: loadSessionAssetBlob,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});
