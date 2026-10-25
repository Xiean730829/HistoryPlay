import {
  CanvasTexture, Color, MeshPhysicalMaterial, MeshStandardMaterial,
  SRGBColorSpace,
} from "three";

function stoneTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建展台纹理");
  context.fillStyle = "#817768";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 40219;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let i = 0; i < 320; i += 1) {
    const shade = Math.round(94 + random() * 92);
    context.fillStyle = `rgba(${shade + 4},${shade},${shade - 8},${0.05 + random() * 0.13})`;
    context.fillRect(random() * 128, random() * 128, 1 + random() * 3, 1 + random() * 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Warm carved stone, aged bronze and low-tint museum glass. */
export function createGalleryMaterials() {
  const stoneMap = stoneTexture();
  const stone = new MeshStandardMaterial({
    color: new Color("#776a58"), map: stoneMap, roughness: 0.88,
  });
  const bronze = new MeshStandardMaterial({ color: "#c58d46", metalness: 0.66, roughness: 0.34 });
  const glass = new MeshPhysicalMaterial({
    color: "#c3d7d4", metalness: 0.04, roughness: 0.1,
    transmission: 0.82, thickness: 0.018, ior: 1.42,
    transparent: true, opacity: 0.2, depthWrite: false,
    envMapIntensity: 0.95,
  });
  return { stone, bronze, glass };
}
