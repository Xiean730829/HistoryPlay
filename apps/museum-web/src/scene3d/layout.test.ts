import { describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture, Vector3 } from "three";
import { maintainSurfaceContact, nearbyModelIndices, RIVER_STATION_SPACING, RIVER_WALKWAY_WIDTH,
  seatModel, stationPlacement } from "./layout";
import { RIVER_RISE_PER_METER, riverHeightAt, riverPointAt, riverStationDistance } from "./riverPath";
import { createRibbonGeometry } from "./particleRiver";
import { disposeTree } from "./resources";

describe("curved river exhibit placement", () => {
  it("maps the full galaxy ribbon once over a rising curve", () => {
    const geometry = createRibbonGeometry(4.8, 20, 3);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(42);
    const firstX = (position.getX(0) + position.getX(1)) / 2;
    const middleX = (position.getX(20) + position.getX(21)) / 2;
    const lastX = (position.getX(40) + position.getX(41)) / 2;
    expect(firstX).not.toBeCloseTo(middleX);
    expect(lastX).not.toBeCloseTo(middleX);
    expect(geometry.getAttribute("uv").getX(0)).toBe(0);
    expect(geometry.getAttribute("uv").getX(position.count - 2)).toBe(1);
    expect(position.getY(position.count - 2)).toBeGreaterThan(position.getY(0));
    geometry.dispose();
  });
  it("releases the particle geometry and material when the scene is disposed", () => {
    const geometry = new BufferGeometry(); const material = new PointsMaterial();
    const a = vi.spyOn(geometry, "dispose"); const b = vi.spyOn(material, "dispose");
    const group = new Group().add(new Points(geometry, material));
    disposeTree(group);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  });

  it("places one exhibit at every alternating bend and keeps it on the shared curve", () => {
    for (let index = 0; index < 6; index += 1) {
      const current = stationPlacement(index);
      expect(current.bendIndex).toBe(index);
      expect(current.distance).toBeCloseTo(riverStationDistance(index));
      expect(current.walkY).toBeCloseTo(riverHeightAt(current.distance));
      expect(current.plinthTop).toBeCloseTo(current.walkY + 0.18);
      if (index > 0) {
        const previous = stationPlacement(index - 1);
        expect(previous.side).toBe(-current.side);
        expect(current.distance - previous.distance).toBeCloseTo(RIVER_STATION_SPACING);
        expect(current.walkY - previous.walkY).toBeCloseTo(RIVER_STATION_SPACING * RIVER_RISE_PER_METER);
      }
      const center = riverPointAt(current.distance);
      expect(Math.hypot(current.x - center.x, current.z - center.z))
        .toBeCloseTo(RIVER_WALKWAY_WIDTH / 2 + 1.55);
    }
    expect(stationPlacement(0).centerX).toBeCloseTo(3.1);
    expect(stationPlacement(1).centerX).toBeCloseTo(-3.1);
  });

  it("uses a gentle continuous grade instead of discrete step elevations", () => {
    for (let distance = 0; distance < 80; distance += 0.25) {
      expect(riverHeightAt(distance + 0.25) - riverHeightAt(distance))
        .toBeCloseTo(0.25 * RIVER_RISE_PER_METER);
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
