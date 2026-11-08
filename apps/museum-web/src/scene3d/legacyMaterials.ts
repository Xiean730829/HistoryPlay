import { Color, LinearSRGBColorSpace, SRGBColorSpace } from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/addons/loaders/GLTFLoader.js";

/** Restore the authored diffuse colour of older glTF specular-glossiness assets. */
export function legacyMaterials(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: "KHR_materials_pbrSpecularGlossiness",
    extendMaterialParams(index, params) {
      const legacy = parser.json.materials?.[index]?.extensions?.KHR_materials_pbrSpecularGlossiness;
      if (!legacy) return null;
      const factor = legacy.diffuseFactor ?? [1, 1, 1, 1];
      params.color = new Color().setRGB(factor[0], factor[1], factor[2], LinearSRGBColorSpace);
      params.opacity = factor[3];
      params.metalness = 0;
      params.roughness = 1 - (legacy.glossinessFactor ?? 1);
      return legacy.diffuseTexture
        ? parser.assignTexture(params, "map", legacy.diffuseTexture, SRGBColorSpace)
        : Promise.resolve();
    },
  };
}
