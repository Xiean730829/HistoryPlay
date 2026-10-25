import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, Vector3 } from "three";
import { buildGallery } from "./architecture";
import { disposeTree } from "./resources";

afterEach(() => vi.unstubAllGlobals());

it("builds only fine display cases and low pedestals, with no blocking hall architecture", () => {
  const drawing = new Proxy({}, { get: () => () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 128, height: 128, getContext: () => drawing }) });
  const gallery = buildGallery(3); gallery.updateMatrixWorld(true);
  try {
    const sizes: number[][] = [];
    gallery.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const bounds = new Box3().setFromObject(object);
      const size = bounds.getSize(new Vector3());
      sizes.push([size.x, size.y, size.z]);
    });
    expect(sizes.length).toBeGreaterThan(30);
    expect(sizes.every(([width, height, depth]) => Math.max(width ?? 0, height ?? 0, depth ?? 0) <= 2.3)).toBe(true);
    expect(gallery.children.some((child) => child.name.includes("stair") || child.name.includes("pillar"))).toBe(false);
  } finally { disposeTree(gallery); }
});
