import {
  CanvasTexture, Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace,
} from "three";
import { galleryVisualTheme } from "./visualTheme";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function surfaceTexture(kind: "stone" | "timber"): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建展厅材质纹理");
  const random = seeded(kind === "stone" ? 1918 : 618);
  context.fillStyle = kind === "stone" ? "#b5aa95" : "#68513a";
  context.fillRect(0, 0, 256, 256);
  if (kind === "stone") {
    for (let i = 0; i < 1200; i++) {
      const shade = Math.round(80 + random() * 100);
      context.fillStyle = `rgba(${shade},${shade - 4},${shade - 12},${0.035 + random() * 0.08})`;
      context.fillRect(random() * 256, random() * 256, 1 + random() * 7, 1 + random() * 4);
    }
    for (let i = 0; i < 16; i++) {
      context.strokeStyle = `rgba(72,64,52,${0.04 + random() * 0.06})`;
      context.lineWidth = 1 + random() * 2;
      context.beginPath();
      const x = random() * 256; const y = random() * 256;
      context.moveTo(x, y); context.lineTo(x + random() * 55 - 27, y + random() * 45 - 22);
      context.stroke();
    }
  } else {
    for (let i = 0; i < 42; i++) {
      const shade = Math.round(35 + random() * 48);
      context.strokeStyle = `rgba(${shade + 24},${shade},${shade - 12},${0.1 + random() * 0.24})`;
      context.lineWidth = 1 + random() * 5;
      context.beginPath();
      const x = random() * 256;
      context.moveTo(x, 0); context.bezierCurveTo(x - 12, 90, x + 16, 170, x + random() * 8 - 4, 256);
      context.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Build one small reusable material set so repeated hall details share GPU resources. */
export function createGalleryMaterials() {
  const stoneMap = surfaceTexture("stone");
  const timberMap = surfaceTexture("timber");
  const stone = (tint: string) => new MeshStandardMaterial({
    color: tint, map: stoneMap, roughness: 0.94, bumpMap: stoneMap, bumpScale: 0.025,
  });
  const bronze = new MeshStandardMaterial({
    color: galleryVisualTheme.colors.bronze, metalness: 0.72, roughness: 0.32,
  });
  const glass = new MeshPhysicalMaterial({
    color: new Color(galleryVisualTheme.colors.caseGlass), metalness: 0.03, roughness: 0.13,
    transparent: true, opacity: 0.105, depthWrite: false, side: DoubleSide,
    envMapIntensity: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.12,
  });
  return {
    stone: stone(galleryVisualTheme.colors.stone),
    stoneTiles: [stone("#978e7e"), stone("#a19886"), stone("#8f8779"), stone("#a49b89")],
    plaster: new MeshStandardMaterial({ color: galleryVisualTheme.colors.plaster, roughness: 0.96, bumpMap: stoneMap, bumpScale: 0.012 }),
    timber: new MeshStandardMaterial({ color: "#8c7150", map: timberMap, roughness: 0.76, bumpMap: timberMap, bumpScale: 0.028 }),
    lacquer: new MeshStandardMaterial({ color: galleryVisualTheme.colors.lacquer, map: timberMap, roughness: 0.58, bumpMap: timberMap, bumpScale: 0.012 }),
    darkTimber: new MeshStandardMaterial({ color: galleryVisualTheme.colors.timber, map: timberMap, roughness: 0.66, bumpMap: timberMap, bumpScale: 0.016 }),
    celadon: new MeshStandardMaterial({ color: galleryVisualTheme.colors.celadon, roughness: 0.57 }),
    bronze,
    plinth: new MeshStandardMaterial({ color: "#40372c", map: timberMap, roughness: 0.62, bumpMap: timberMap, bumpScale: 0.014 }),
    glass,
  };
}
