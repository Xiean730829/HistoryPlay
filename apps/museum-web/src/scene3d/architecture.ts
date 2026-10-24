import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Material, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import { stationPlacement } from "./layout";

export function inscription(text: string, width = 2, height = 0.5, floor = false): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = "#ead7b6";
  ctx.font = '56px "Songti SC", "SimSun", serif';
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 512, 128, 980);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const plane = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({
    map: texture, color: "#ead7b6", transparent: true, depthWrite: false,
  }));
  if (floor) plane.rotation.x = -Math.PI / 2;
  return plane;
}

function box(hall: Group, w: number, h: number, d: number, x: number, y: number, z: number, material: Material): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  hall.add(mesh); return mesh;
}

function addShowcase(hall: Group, materials: ReturnType<typeof createGalleryMaterials>, x: number, top: number, z: number): void {
  const width = 2.42; const depth = 2.04; const height = 2.12;
  const bottom = top + 0.075; const upper = top + height;
  const rail = 0.042; const glassHeight = height - rail * 2;
  const glassY = bottom + glassHeight / 2;
  const glass = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const pane = box(hall, w, h, d, px, py, pz, materials.glass);
    pane.castShadow = false; pane.receiveShadow = false; pane.renderOrder = 2;
    // Keep transparent case faces from swallowing the exhibit hit target.
    pane.raycast = () => undefined;
    return pane;
  };
  // Thin, readable glass planes and a subdued lid keep the true object legible through the case.
  glass(width - rail, glassHeight, 0.012, x, glassY, z + depth / 2);
  glass(width - rail, glassHeight, 0.012, x, glassY, z - depth / 2);
  glass(0.012, glassHeight, depth - rail, x - width / 2, glassY, z);
  glass(0.012, glassHeight, depth - rail, x + width / 2, glassY, z);
  glass(width - rail, 0.012, depth - rail, x, upper - rail / 2, z);
  for (const side of [-1, 1]) {
    box(hall, rail, height, rail, x + side * (width / 2 - rail / 2), top + height / 2, z + depth / 2 - rail / 2, materials.bronze);
    box(hall, rail, height, rail, x + side * (width / 2 - rail / 2), top + height / 2, z - depth / 2 + rail / 2, materials.bronze);
    box(hall, width, rail, rail, x, bottom + rail / 2, z + side * (depth / 2 - rail / 2), materials.bronze);
    box(hall, width, rail, rail, x, upper - rail / 2, z + side * (depth / 2 - rail / 2), materials.bronze);
    box(hall, rail, rail, depth, x + side * (width / 2 - rail / 2), upper - rail / 2, z, materials.bronze);
    box(hall, rail, rail, depth, x + side * (width / 2 - rail / 2), bottom + rail / 2, z, materials.bronze);
  }
  // Narrow bronze sill reflects a little warm case light without covering the true GLB.
  box(hall, width - 0.08, 0.018, depth - 0.08, x, top + 0.09, z, materials.bronze);
}

/** Modular palace-inspired museum hall; proportions are theatrical, not a site reconstruction. */
export function buildHall(count: number): Group {
  const hall = new Group(); hall.name = "palace-museum-architecture";
  const length = Math.max(26, count * 5.8 + 10);
  const materials = createGalleryMaterials();
  box(hall, 12, 0.2, length + 6, 0, -0.13, -length / 2 + 6, materials.stone);
  // Reused shared materials keep the tiled floor detailed without creating one material per tile.
  for (let row = 0; row < Math.ceil((length + 6) / 1.5); row++) {
    for (let col = 0; col < 8; col++) {
      box(hall, 1.486, 0.025, 1.486, -5.25 + col * 1.5, -0.012, 8.25 - row * 1.5,
        materials.stoneTiles[(row * 3 + col * 5) % materials.stoneTiles.length]);
    }
  }
  for (const x of [-5.6, 5.6]) {
    box(hall, 0.55, 0.75, length, x, 0.36, -length / 2 + 5, materials.stone);
    box(hall, 0.42, 0.2, length, x, 0.88, -length / 2 + 5, materials.timber);
    // Leave the middle wall bays open so lattice windows read as openings, not surface decoration.
    box(hall, 0.3, 0.48, length, x, 1.22, -length / 2 + 5, materials.plaster);
    box(hall, 0.3, 0.55, length, x, 4.62, -length / 2 + 5, materials.plaster);
    box(hall, 0.42, 0.16, length, x, 4.92, -length / 2 + 5, materials.timber);
    box(hall, 0.55, 0.3, length, x, 5.02, -length / 2 + 5, materials.bronze);
  }
  for (let z = 7; z > -length + 4; z -= 4.2) {
    for (const x of [-4.85, 4.85]) {
      const base = box(hall, 0.82, 0.22, 0.82, x, 0.13, z, materials.stone);
      base.castShadow = false;
      const column = new Mesh(new CylinderGeometry(0.23, 0.29, 4.55, 28), materials.lacquer);
      column.position.set(x, 2.48, z); column.castShadow = true; column.receiveShadow = true; hall.add(column);
      box(hall, 0.64, 0.2, 0.64, x, 4.78, z, materials.timber);
      box(hall, 0.96, 0.13, 0.72, x, 4.94, z, materials.bronze);
      // Recessed lattice is framed by timber instead of a flat dark strip.
      for (let offset = 0.25; offset < 3.9; offset += 0.55) {
        box(hall, 0.075, 3.15, 0.09, Math.sign(x) * 5.52, 2.45, z - offset, materials.timber);
      }
      for (const y of [1.05, 1.8, 2.55, 3.3, 4.05]) {
        box(hall, 0.085, 0.08, 4.05, Math.sign(x) * 5.52, y, z - 2.0, materials.timber);
      }
    }
    box(hall, 10.2, 0.34, 0.48, 0, 5.23, z, materials.lacquer);
    box(hall, 10.35, 0.12, 0.55, 0, 5.02, z, materials.celadon);
    box(hall, 10.3, 0.06, 0.58, 0, 4.93, z, materials.bronze);
  }
  // Dark timber roof coffers and layered beams leave a narrow skylight for soft top light.
  box(hall, 3.7, 0.2, length, -3.05, 5.62, -length / 2 + 5, materials.darkTimber);
  box(hall, 3.7, 0.2, length, 3.05, 5.62, -length / 2 + 5, materials.darkTimber);
  for (let z = 7; z > -length + 4; z -= 4.2) {
    box(hall, 12.1, 0.18, 0.34, 0, 5.78, z, materials.lacquer);
  }
  box(hall, 12, 5.8, 0.4, 0, 2.8, -length + 5, materials.lacquer);
  box(hall, 4, 3.6, 0.2, 0, 1.8, -length + 5.3, materials.darkTimber);
  const endSign = inscription("大 唐 · 时 空 之 廊", 4.6, 1.15);
  endSign.position.set(0, 4.3, -length + 5.55); hall.add(endSign);
  for (let i = 0; i < count; i++) {
    const { x, z, top } = stationPlacement(i);
    box(hall, 2.12, top, 1.75, x, top / 2, z, materials.plinth);
    box(hall, 2.2, 0.075, 1.83, x, top, z, materials.bronze);
    box(hall, 2.27, 0.1, 1.9, x, 0.05, z, materials.darkTimber);
    addShowcase(hall, materials, x, top, z);
  }
  hall.add(buildGalleryLighting(count));
  return hall;
}
