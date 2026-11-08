import { describe, expect, it, vi } from "vitest";
import { SRGBColorSpace } from "three";
import type { GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { legacyMaterials } from "./legacyMaterials";

describe("legacy glTF materials", () => {
  it("loads the original diffuse texture and factors from a specular-glossiness material", async () => {
    const texture = { index: 0 };
    const assignTexture = vi.fn(async (params: Record<string, unknown>, key: string, info: unknown) => { params[key] = info; return null; });
    const parser = { json: { materials: [{ extensions: { KHR_materials_pbrSpecularGlossiness: {
      diffuseTexture: texture, diffuseFactor: [0.3, 0.4, 0.5, 0.8], glossinessFactor: 0.35,
    } } }] }, assignTexture } as unknown as GLTFParser;
    const params: Record<string, any> = {};
    await legacyMaterials(parser).extendMaterialParams!(0, params);
    expect(assignTexture).toHaveBeenCalledWith(params, "map", texture, SRGBColorSpace);
    expect(params.map).toEqual(texture);
    expect(params.color.toArray()).toEqual([0.3, 0.4, 0.5]);
    expect(params.opacity).toBe(0.8);
    expect(params.roughness).toBeCloseTo(0.65);
    expect(params.metalness).toBe(0);
  });

  it("leaves modern materials unchanged", () => {
    const parser = { json: { materials: [{}] }, assignTexture: vi.fn() } as unknown as GLTFParser;
    const params = { metalness: 0.8 };
    expect(legacyMaterials(parser).extendMaterialParams!(0, params)).toBeNull();
    expect(params.metalness).toBe(0.8);
    expect(parser.assignTexture).not.toHaveBeenCalled();
  });
});
