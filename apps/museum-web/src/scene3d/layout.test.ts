import { describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture, Vector3 } from "three";
import { LANDING_RISE, maintainSurfaceContact, nearbyModelIndices, RIVER_STATION_SPACING, seatModel,
  STAIR_STEP_RISE, STAIR_STEPS_PER_FLIGHT, stairStepPlacement, stationPlacement } from "./layout";
import { riverPointAt } from "./riverPath";
import { createRibbonGeometry } from "./particleRiver";
import { disposeTree } from "./resources";

describe("ascending stair exhibit placement", () => {
  it("builds a textured center ribbon aligned with the curved central staircase", () => {
    const geometry = createRibbonGeometry(4.8, 20);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(42);
    const firstX = (position.getX(0) + position.getX(1)) / 2;
    const middleX = (position.getX(20) + position.getX(21)) / 2;
    const lastX = (position.getX(40) + position.getX(41)) / 2;
    expect(firstX).not.toBeCloseTo(middleX);
    expect(lastX).not.toBeCloseTo(middleX);
    geometry.dispose();
  });
  it("releases the particle geometry and material when the scene is disposed", () => {
    const geometry = new BufferGeometry(); const material = new PointsMaterial();
    const a = vi.spyOn(geometry, "dispose"); const b = vi.spyOn(material, "dispose");
    const group = new Group().add(new Points(geometry, material));
    disposeTree(group);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  });

  it("raises world-space walk, landing and plinth heights with alternating artifact stations", () => {
    for (let index = 0; index < 6; index += 1) {
      const current = stationPlacement(index);
      expect(current.walkY).toBeCloseTo(index * LANDING_RISE);
      expect(current.landingY).toBeCloseTo(current.walkY);
      expect(current.plinthTop).toBeCloseTo(current.landingY + 0.18);
      if (index > 0) {
        const previous = stationPlacement(index - 1);
        expect(previous.side).toBe(-current.side);
        expect(current.distance - previous.distance).toBeCloseTo(RIVER_STATION_SPACING);
        expect(current.landingY - previous.landingY).toBeCloseTo(LANDING_RISE);
      }
      const center = riverPointAt(current.distance);
      expect(Math.hypot(current.x - center.x, current.z - center.z)).toBeCloseTo(4.1);
    }
  });

  it("uses one tread placement contract for the built stair and the rising visitor path", () => {
    const first = stairStepPlacement(0, 0);
    const last = stairStepPlacement(0, STAIR_STEPS_PER_FLIGHT - 1);
    expect(first.height).toBeCloseTo(STAIR_STEP_RISE);
    expect(first.topY).toBeCloseTo(STAIR_STEP_RISE);
    expect(last.topY).toBeCloseTo(LANDING_RISE);
    expect(last.distance + last.treadDepth).toBeCloseTo(RIVER_STATION_SPACING);
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
