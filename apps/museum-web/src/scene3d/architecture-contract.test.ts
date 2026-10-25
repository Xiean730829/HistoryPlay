import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import { buildGallery } from "./architecture";
import { disposeTree } from "./resources";

afterEach(() => vi.unstubAllGlobals());

it("builds rising stone steps, warm metal edges and transmissive glass artifact cases", () => {
  const drawing = new Proxy({}, { get: () => () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 128, height: 128, getContext: () => drawing }) });
  const gallery = buildGallery(3); gallery.updateMatrixWorld(true);
  try {
    const stairs: Mesh[] = [];
    const landings: Mesh[] = [];
    const glass: Mesh[] = [];
    gallery.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object.name.startsWith("stair-step-")) stairs.push(object);
      if (object.name.startsWith("stair-landing-")) landings.push(object);
      if (object.userData.pickThrough && object.material instanceof MeshPhysicalMaterial
        && object.material.transmission > 0.5) glass.push(object);
    });
    expect(stairs).toHaveLength(20);
    expect(landings).toHaveLength(3);
    expect(glass.length).toBeGreaterThanOrEqual(15);
    const first = new Box3().setFromObject(stairs[0]!);
    const later = new Box3().setFromObject(stairs[9]!);
    expect(later.max.y).toBeGreaterThan(first.max.y);
    expect(first.getSize(new Vector3()).x).toBeGreaterThan(2.5);
    expect(gallery.name).toBe("ascending-stair-galaxy-gallery");
  } finally { disposeTree(gallery); }
});
