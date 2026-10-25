import { describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture, Vector3 } from "three";
import { DISPLAY_CASE_BASE_Y, maintainSurfaceContact, nearbyModelIndices, RIVER_STATION_SPACING, seatModel, stationPlacement } from "./layout";
import { disposeTree } from "./resources";

describe("particle-river exhibit placement", () => {
  it("releases the particle geometry and material when the scene is disposed", () => {
    const geometry = new BufferGeometry(); const material = new PointsMaterial();
    const a = vi.spyOn(geometry, "dispose"); const b = vi.spyOn(material, "dispose");
    const group = new Group().add(new Points(geometry, material));
    disposeTree(group);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  });

  it("keeps every exhibit at one world height and alternating beside the river", () => {
    for (let index = 0; index < 6; index += 1) {
      const current = stationPlacement(index);
      expect(current.plinthTop).toBe(DISPLAY_CASE_BASE_Y);
      if (index > 0) {
        const previous = stationPlacement(index - 1);
        expect(previous.x * current.x).toBeLessThan(0);
        expect(previous.z - current.z).toBeCloseTo(RIVER_STATION_SPACING);
      }
    }
  });

  it("keeps tilted true models resting on the thin pedestal", () => {
    const root = new Group(); root.position.y = stationPlacement(2).plinthTop + 0.014;
    const spin = seatModel(new Group().add(new Mesh(new BoxGeometry(1, 2, 1)))); root.add(spin);
    root.updateMatrixWorld(true); spin.rotation.x = 0.4;
    maintainSurfaceContact(spin, root.position.y);
    expect(new Box3().setFromObject(spin).min.y).toBeCloseTo(root.position.y);
  });

  it("keeps the nearby model window bounded as the river grows", () => {
    expect([...nearbyModelIndices(3, 0)]).toEqual([0, 1, 2]);
    expect([...nearbyModelIndices(19, 12)]).toEqual([12, 11, 13]);
  });

  it("centers an offset GLB and preserves its aspect ratio", () => {
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

  it("releases shared case textures and geometry once", () => {
    const geometry = new BoxGeometry(); const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const a = vi.spyOn(geometry, "dispose"); const b = vi.spyOn(material, "dispose");
    const c = vi.spyOn(texture, "dispose");
    const group = new Group(); group.add(new Mesh(geometry, material), new Mesh(geometry, material));
    disposeTree(group);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); expect(c).toHaveBeenCalledTimes(1);
  });
});
