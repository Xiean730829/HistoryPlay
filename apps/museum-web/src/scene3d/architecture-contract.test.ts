import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh } from "three";
import { buildHall } from "./architecture";
import { stationPlacement } from "./layout";
import { disposeTree } from "./resources";

afterEach(() => vi.unstubAllGlobals());

it("physically supports each raised deck continuously from its landing surface", () => {
  // Geometry-only test: the drawing context supplies no pixels and proves no visual quality.
  const drawing = new Proxy({}, { get: () => () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 256, height: 256, getContext: () => drawing }) });
  const hall = buildHall(3); hall.updateMatrixWorld(true);
  try {
    for (let index = 0; index < 3; index++) {
      const p = stationPlacement(index);
      const spans: Array<[number, number]> = [];
      hall.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material) => material.transparent)) return;
        const bounds = new Box3().setFromObject(object);
        if (bounds.min.x <= p.x && bounds.max.x >= p.x && bounds.min.z <= p.z && bounds.max.z >= p.z) {
          spans.push([Math.max(p.landingY, bounds.min.y), Math.min(p.plinthTop, bounds.max.y)]);
        }
      });
      let supported = p.landingY;
      for (const [bottom, top] of spans.sort((a, b) => a[0] - b[0])) {
        if (top < bottom || bottom > supported + 0.001) continue;
        supported = Math.max(supported, top);
      }
      expect(supported, `station ${index} has an unsupported deck gap`).toBeCloseTo(p.plinthTop, 3);
    }
  } finally { disposeTree(hall); }
});
