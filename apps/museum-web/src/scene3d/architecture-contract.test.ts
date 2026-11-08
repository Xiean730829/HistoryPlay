import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { buildGallery } from "./architecture";
import { disposeTree } from "./resources";
import { stationPlacement } from "./layout";

afterEach(() => vi.unstubAllGlobals());

it("builds one level walkway and transmissive glass cases without stair geometry", () => {
  const drawing = new Proxy({}, { get: () => () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 128, height: 128, getContext: () => drawing }) });
  const gallery = buildGallery(8); gallery.updateMatrixWorld(true);
  try {
    const walkways: Mesh[] = [];
    const stairs: Mesh[] = [];
    const glass: Mesh[] = [];
    gallery.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object.name === "galaxy-river-walkway") walkways.push(object);
      if (object.name.startsWith("stair-") || object.name.startsWith("step-")) stairs.push(object);
      if (object.userData.pickThrough && object.material instanceof MeshPhysicalMaterial
        && object.material.transmission > 0.5) glass.push(object);
    });
    expect(walkways).toHaveLength(1);
    expect(stairs).toHaveLength(0);
    const pathBounds = new Box3().setFromObject(walkways[0]!);
    expect(pathBounds.getSize(new Vector3()).x).toBeGreaterThan(20);
    expect(pathBounds.getSize(new Vector3()).z).toBeGreaterThan(4);
    expect(pathBounds.getSize(new Vector3()).y).toBeLessThan(1);
    expect(stationPlacement(0).walkY).toBeCloseTo(stationPlacement(7).walkY);
    expect(glass.length).toBeGreaterThanOrEqual(15);
    expect(gallery.name).toBe("horizontal-galaxy-river-gallery");
  } finally { disposeTree(gallery); }
});
