import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import { MuseumWorld } from "./MuseumWorld";

afterEach(() => vi.restoreAllMocks());

describe("当前文物渲染失败的归属", () => {
  it.each([
    { failedId: "coin", previewVisible: false, reports: 1 },
    { failedId: "neighbor", previewVisible: false, reports: 0 },
    { failedId: "coin", previewVisible: true, reports: 0 },
  ])("失败的$failedId、预览$previewVisible不会误取消另一件文物的介绍", async ({ failedId, previewVisible, reports }) => {
    vi.spyOn(galleryAssets, "acquire").mockRejectedValue(new Error("local asset missing"));
    const onRender = vi.fn();
    // Run the real async loader/catch path without constructing a GPU renderer.
    const world = Object.assign(Object.create(MuseumWorld.prototype), {
      latest: { state: { focused_entity_id: "coin" } }, disposed: false,
      hooks: { onRender }, showPreview: vi.fn().mockResolvedValue(undefined),
    }) as { loadModel(artifact: ArtifactProjection, entry: unknown): Promise<void> };
    const artifact = { id: failedId, presentation: { display: { kind: "model3d", asset_id: "test-model" } } } as ArtifactProjection;
    const entry = { controller: new AbortController(), previewVisible, loading: false, attempted: false };
    await world.loadModel(artifact, entry);
    expect(onRender).toHaveBeenCalledTimes(reports);
    expect(entry.loading).toBe(false);
  });
});
