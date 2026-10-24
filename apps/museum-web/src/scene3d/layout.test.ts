import { describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import { nearbyModelIndices, seatModel, stationPlacement } from "./layout";
import { disposeTree } from "./resources";

describe("physical exhibit placement", () => {
  it("keeps the three-object slice visible while bounding later galleries to nearest models", () => {
    expect([...nearbyModelIndices(3, 0)]).toEqual([0, 1, 2]);
    expect([...nearbyModelIndices(19, 12)]).toEqual([12, 11, 13]);
  });
  it("centers offset GLB geometry, keeps its aspect and places its bottom on the table", () => {
    const model = new Group();
    const mesh = new Mesh(new BoxGeometry(4, 8, 2)); mesh.position.set(20, -30, 7); model.add(mesh);
    const seated = seatModel(model, 2, 3);
    const bounds = new Box3().setFromObject(seated);
    const size = bounds.getSize(new Vector3());
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(0);
    expect(size.x / size.y).toBeCloseTo(0.5);
    expect(size.y).toBeCloseTo(3);
  });
  it("separates exhibits in real depth and frees shared resources exactly once", () => {
    expect(stationPlacement(2).z).toBeLessThan(stationPlacement(1).z);
    const geometry = new BoxGeometry(); const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const a = vi.spyOn(geometry, "dispose"); const b = vi.spyOn(material, "dispose");
    const c = vi.spyOn(texture, "dispose");
    const group = new Group(); group.add(new Mesh(geometry, material), new Mesh(geometry, material));
    disposeTree(group);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); expect(c).toHaveBeenCalledTimes(1);
  });
});
