import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { buildGallery } from "./architecture";
import { disposeTree } from "./resources";

afterEach(() => vi.unstubAllGlobals());

it("builds one continuous curved walkway and transmissive glass artifact cases without stair geometry", () => {
  const drawing = new Proxy({}, { get: () => () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 128, height: 128, getContext: () => drawing }) });
  const gallery = buildGallery(3); gallery.updateMatrixWorld(true);
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
    expect(pathBounds.getSize(new Vector3()).z).toBeGreaterThan(50);
    expect(pathBounds.getSize(new Vector3()).x).toBeGreaterThan(8);
    expect(pathBounds.max.y).toBeGreaterThan(pathBounds.min.y + 1);
    expect(glass.length).toBeGreaterThanOrEqual(15);
    expect(gallery.name).toBe("sinuous-galaxy-river-gallery");
  } finally { disposeTree(gallery); }
});
