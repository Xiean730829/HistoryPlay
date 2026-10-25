import {
  CanvasTexture, Color, MeshStandardMaterial,
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

/** Stone and warm metal are reserved for the thin circular exhibit supports. */
export function createGalleryMaterials() {
  const stoneMap = stoneTexture();
  const stone = new MeshStandardMaterial({
    color: new Color("#c3b49a"), map: stoneMap, roughness: 0.84,
  });
  const bronze = new MeshStandardMaterial({ color: "#c4a06b", metalness: 0.58, roughness: 0.4 });
  return { stone, bronze };
}
