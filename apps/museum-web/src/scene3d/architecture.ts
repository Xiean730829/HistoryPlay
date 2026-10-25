import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import { stationPlacement } from "./layout";

function bar(group: Group, material: MeshStandardMaterial, width: number, height: number, depth: number,
  x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => undefined;
  group.add(mesh);
  return mesh;
}

function addCase(group: Group, x: number, z: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const width = 2.15;
  const depth = 1.82;
  const baseY = 0.18;
  const height = 2.28;
  const rail = 0.018;
  const glassMaterial = materials.glass;
  const pane = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), glassMaterial);
    mesh.position.set(px, py, pz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.pickThrough = true;
    mesh.raycast = () => undefined;
    group.add(mesh);
  };
  const midY = baseY + height / 2;
  // Barely visible glass planes keep the real model readable against the full-bleed scene.
  pane(width - rail, height - rail, 0.008, x, midY, z + depth / 2);
  pane(width - rail, height - rail, 0.008, x, midY, z - depth / 2);
  pane(0.008, height - rail, depth - rail, x - width / 2, midY, z);
  pane(0.008, height - rail, depth - rail, x + width / 2, midY, z);
  pane(width - rail, 0.008, depth - rail, x, baseY + height, z);

  const halfW = width / 2;
  const halfD = depth / 2;
  const topY = baseY + height;
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    bar(group, materials.bronze, rail, height, rail, x + sideX * (halfW - rail / 2), midY,
      z + sideZ * (halfD - rail / 2));
  }
  for (const sideZ of [-1, 1]) {
    bar(group, materials.bronze, width, rail, rail, x, baseY + rail / 2, z + sideZ * (halfD - rail / 2));
    bar(group, materials.bronze, width, rail, rail, x, topY - rail / 2, z + sideZ * (halfD - rail / 2));
  }
  for (const sideX of [-1, 1]) {
    bar(group, materials.bronze, rail, rail, depth, x + sideX * (halfW - rail / 2), baseY + rail / 2, z);
    bar(group, materials.bronze, rail, rail, depth, x + sideX * (halfW - rail / 2), topY - rail / 2, z);
  }

  const pedestal = new Mesh(new CylinderGeometry(1.03, 1.08, 0.16, 48), materials.stone);
  pedestal.position.set(x, 0.08, z);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);
  const rim = new Mesh(new CylinderGeometry(1.04, 1.04, 0.018, 48), materials.bronze);
  rim.position.set(x, 0.166, z);
  rim.castShadow = false;
  group.add(rim);
}

/** A quiet row of light glass cases on thin supports; the image remains the full scene backdrop. */
export function buildGallery(count: number): Group {
  const gallery = new Group();
  gallery.name = "open-gallery-particle-river";
  const materials = createGalleryMaterials();
  for (let index = 0; index < count; index += 1) {
    const { x, z } = stationPlacement(index);
    addCase(gallery, x, z, materials);
  }
  gallery.add(buildGalleryLighting(count));
  return gallery;
}
