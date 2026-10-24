import { describe, expect, it } from "vitest";
import type { ArtifactProjection } from "../application/museumApi";
import { resolvePreviewAssetId } from "./previewAsset";

function artifact(partial: Partial<ArtifactProjection> & Pick<ArtifactProjection, "id" | "asset_ids">): ArtifactProjection {
  return {
    title: "样例",
    museum: { name: "馆", accession: "1" },
    time_range: { start_year: 700, end_year: 700, precision: "year" },
    material: "石",
    category: "造像",
    fact_card_ids: [],
    story_entry_ids: [],
    ...partial,
  };
}

describe("resolvePreviewAssetId", () => {
  it("uses presentation.preview_asset_id when authored", () => {
    const id = resolvePreviewAssetId(artifact({
      id: "cn.tang.artifact.stele",
      asset_ids: ["cn.tang.asset.stele.glb", "cn.tang.asset.stele.preview"],
      presentation: {
        preview_asset_id: "cn.tang.asset.stele.preview",
        display: { kind: "model3d", asset_id: "cn.tang.asset.stele.display" },
        teaser: "678年造像碑。",
        background_node_id: "cn.tang.node.stele.01",
      },
    }));
    expect(id).toBe("cn.tang.asset.stele.preview");
  });

  it("falls back to a .preview asset id without taking the first asset", () => {
    const id = resolvePreviewAssetId(artifact({
      id: "cn.tang.artifact.coin",
      asset_ids: ["cn.tang.asset.coin.glb", "cn.tang.asset.coin.preview", "cn.tang.asset.coin.display"],
    }));
    expect(id).toBe("cn.tang.asset.coin.preview");
  });

  it("returns null when no preview binding exists", () => {
    expect(resolvePreviewAssetId(artifact({
      id: "cn.tang.artifact.bowl",
      asset_ids: ["cn.tang.asset.bowl.glb"],
    }))).toBeNull();
  });
});
