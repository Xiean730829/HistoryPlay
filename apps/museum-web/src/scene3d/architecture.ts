import {
  BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, Float32BufferAttribute, Group,
  InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  Points, PointsMaterial, SRGBColorSpace,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import { PLINTH_HEIGHT, STAIR_RISER, STAIR_START_Z, STAIR_TREAD, STAIR_WIDTH, stairStepPlacement, stationPlacement } from "./layout";

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

function addShowcase(hall: Group, materials: ReturnType<typeof createGalleryMaterials>, x: number,
  landingY: number, z: number): void {
  const width = 2.2; const depth = 1.92; const height = 2.05;
  const bottom = landingY + PLINTH_HEIGHT + 0.075; const upper = bottom + height;
  const rail = 0.04; const glassHeight = height - rail * 2;
  const glassY = bottom + glassHeight / 2;
  const glass = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const pane = box(hall, w, h, d, px, py, pz, materials.glass);
    pane.castShadow = false; pane.receiveShadow = false; pane.renderOrder = 2;
    // The frame and panes must never occlude the exhibit picking volume.
    pane.raycast = () => undefined;
    return pane;
  };
  glass(width - rail, glassHeight, 0.012, x, glassY, z + depth / 2);
  glass(width - rail, glassHeight, 0.012, x, glassY, z - depth / 2);
  glass(0.012, glassHeight, depth - rail, x - width / 2, glassY, z);
  glass(0.012, glassHeight, depth - rail, x + width / 2, glassY, z);
  glass(width - rail, 0.012, depth - rail, x, upper - rail / 2, z);
  for (const side of [-1, 1]) {
    box(hall, rail, height, rail, x + side * (width / 2 - rail / 2), bottom + height / 2, z + depth / 2 - rail / 2, materials.bronze);
    box(hall, rail, height, rail, x + side * (width / 2 - rail / 2), bottom + height / 2, z - depth / 2 + rail / 2, materials.bronze);
    box(hall, width, rail, rail, x, bottom + rail / 2, z + side * (depth / 2 - rail / 2), materials.bronze);
    box(hall, width, rail, rail, x, upper - rail / 2, z + side * (depth / 2 - rail / 2), materials.bronze);
    box(hall, rail, rail, depth, x + side * (width / 2 - rail / 2), upper - rail / 2, z, materials.bronze);
    box(hall, rail, rail, depth, x + side * (width / 2 - rail / 2), bottom + rail / 2, z, materials.bronze);
  }
}

function addStairs(hall: Group, count: number, material: MeshStandardMaterial): void {
  const lastStep = count ? stationPlacement(count - 1).stepIndex + 8 : 12;
  const geometry = new BoxGeometry(STAIR_WIDTH, STAIR_RISER, STAIR_TREAD);
  const stairs = new InstancedMesh(geometry, material, lastStep + 1);
  const transform = new Matrix4();
  for (let index = 0; index <= lastStep; index++) {
    const step = stairStepPlacement(index);
    transform.makeTranslation(0, step.walkY - STAIR_RISER / 2, step.z);
    stairs.setMatrixAt(index, transform);
  }
  stairs.instanceMatrix.needsUpdate = true;
  stairs.castShadow = true; stairs.receiveShadow = true;
  hall.add(stairs);
  // Dark side strings make the stepped profile visible without adding a second staircase.
  const endZ = stairStepPlacement(lastStep).z - STAIR_TREAD / 2;
  const endY = stairStepPlacement(lastStep).walkY;
  const run = STAIR_START_Z - endZ;
  const rise = endY + STAIR_RISER;
  for (const side of [-1, 1]) {
    const beam = box(hall, 0.28, Math.hypot(run, rise), 0.32, side * (STAIR_WIDTH / 2 - 0.1), rise / 2 - STAIR_RISER / 2,
      (STAIR_START_Z + endZ) / 2, material);
    beam.rotation.x = Math.atan2(run, rise);
  }
}

function addLanding(hall: Group, x: number, landingY: number, z: number, side: number,
  materials: ReturnType<typeof createGalleryMaterials>): void {
  const platformX = side * 3.325;
  const platformWidth = 2.45; const platformDepth = 3.1; const slab = 0.22;
  box(hall, platformWidth, slab, platformDepth, platformX, landingY - slab / 2, z, materials.stone);
  // Four visible stone piers carry the side deck down to the entrance floor.
  const pierHeight = Math.max(0.14, landingY + 0.13);
  for (const dx of [-0.78, 0.78]) for (const dz of [-1.02, 1.02]) {
    box(hall, 0.42, pierHeight, 0.42, platformX + dx, (landingY - 0.13) / 2, z + dz, materials.plinth);
  }
  // A layered stone base gives the cabinet a dark, legible silhouette.
  box(hall, 2.32, 0.68, 2.08, x, landingY + 0.34, z, materials.plinth);
  box(hall, 2.42, 0.08, 2.18, x, landingY + 0.72, z, materials.stone);
  box(hall, 2.24, 0.08, 2.02, x, landingY + PLINTH_HEIGHT - 0.04, z, materials.bronze);
  addShowcase(hall, materials, x, landingY, z);
}

function addBrokenPiers(hall: Group, count: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const rand = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
  const stations = Math.max(1, count);
  for (let index = 0; index < stations; index++) {
    const p = stationPlacement(index);
    const floor = p.landingY;
    for (const side of [-1, 1]) {
      const x = side * (5.05 + rand(index * 4 + side + 8) * 0.5);
      const height = 3.2 + rand(index * 9 + side + 2) * 2.7;
      const pillar = new Mesh(new CylinderGeometry(0.33, 0.48, height, 8, 1), materials.stone);
      pillar.position.set(x, floor + height / 2, p.z + (rand(index * 3 + side + 14) - 0.5) * 0.85);
      pillar.rotation.z = (rand(index * 5 + side + 20) - 0.5) * 0.13;
      pillar.castShadow = true; pillar.receiveShadow = true; hall.add(pillar);
      const crownHeight = floor + height;
      if (rand(index * 11 + side + 7) > 0.28) {
        const lintel = box(hall, 3.15 + rand(index + side + 24) * 1.3, 0.42, 0.46,
          side * 3.98, crownHeight - 0.12, p.z + 0.2, materials.stone);
        lintel.rotation.z = (rand(index + side + 18) - 0.5) * 0.09;
      }
      // Broken arch fragments and loose blocks form a ruined skyline, not a repeated corridor.
      if (rand(index * 17 + side + 5) > 0.4) {
        const fragment = box(hall, 1.5 + rand(index * 7 + side + 2), 0.38, 0.62,
          side * (4.35 + rand(index + 19) * 0.9), floor + 2.0 + rand(index * 2 + side) * 2.2,
          p.z - 1.1, materials.stone);
        fragment.rotation.z = side * (0.08 + rand(index * 13 + 6) * 0.2);
        fragment.rotation.y = rand(index * 19 + side) * 0.25;
      }
    }
    for (const side of [-1, 1]) {
      const rubble = box(hall, 0.65 + rand(index + side + 21), 0.22 + rand(index * 2 + side) * 0.28,
        0.7 + rand(index * 6 + side) * 0.5, side * (4.45 + rand(index * 5 + side) * 0.6),
        floor + 0.12, p.z + (rand(index * 3 + side + 29) - 0.5) * 2.1, materials.stone);
      rubble.rotation.y = rand(index * 2 + side + 33) * 0.5;
      rubble.rotation.z = (rand(index * 4 + side + 26) - 0.5) * 0.15;
    }
  }
  // A distant broken gate gives the ascent a scale cue and a warm endpoint.
  const end = count ? stationPlacement(count - 1) : stationPlacement(0);
  const gateY = end.landingY + 2.1;
  const gateZ = end.z - 4.8;
  for (const x of [-3.25, 3.25]) {
    const pillar = box(hall, 0.8, 5.8, 1.05, x, gateY + 1.8, gateZ, materials.stone);
    pillar.rotation.z = x < 0 ? -0.06 : 0.055;
  }
  const header = box(hall, 7.7, 0.95, 1.15, 0, gateY + 4.25, gateZ, materials.stone);
  header.rotation.z = -0.025;
  box(hall, 5.9, 4.0, 0.25, 0, gateY + 1.85, gateZ - 0.63, materials.darkTimber);
}

function addDust(hall: Group, minZ: number, maxZ: number, topY: number): void {
  const count = 110; const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const seed = index + 1;
    positions[index * 3] = (Math.sin(seed * 14.51) * 0.5 + 0.5) * 11 - 5.5;
    positions[index * 3 + 1] = 0.35 + (Math.sin(seed * 91.7) * 0.5 + 0.5) * Math.max(2, topY);
    positions[index * 3 + 2] = minZ + (Math.sin(seed * 53.13) * 0.5 + 0.5) * (maxZ - minZ);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const points = new Points(geometry, new PointsMaterial({ color: "#f1c77d", size: 0.055,
    transparent: true, opacity: 0.28, depthWrite: false, sizeAttenuation: true }));
  points.renderOrder = 1; hall.add(points);
}

/** A dark, broken-stone ascent with artifact landings aligned to the shared station contract. */
export function buildHall(count: number): Group {
  const hall = new Group(); hall.name = "staircase-ruins-museum-architecture";
  const materials = createGalleryMaterials();
  const placements = Array.from({ length: count }, (_, index) => stationPlacement(index));
  const firstZ = placements[0]?.z ?? stationPlacement(0).z;
  const last = placements.at(-1) ?? stationPlacement(0);
  const frontZ = STAIR_START_Z + 11;
  const backZ = last.z - 10;
  const length = frontZ - backZ;

  box(hall, 14, 0.28, length + 1, 0, -0.28, (frontZ + backZ) / 2, materials.stone);
  // Side retaining walls are broken into uneven masses to expose the open ruin chamber.
  for (const side of [-1, 1]) {
    for (let index = 0; index < Math.max(2, count); index++) {
      const p = placements[index] ?? stationPlacement(index);
      const wallHeight = 1.7 + (index % 3) * 0.62;
      const wall = box(hall, 0.62, wallHeight, 2.9, side * 6.5, p.landingY + wallHeight / 2 - 0.14,
        p.z - (index % 2) * 1.15, index % 2 ? materials.stone : materials.plaster);
      wall.rotation.z = side * (index % 2 ? 0.06 : -0.035);
    }
  }
  addStairs(hall, count, materials.stone);
  placements.forEach((p, index) => addLanding(hall, p.x, p.landingY, p.z, index % 2 ? 1 : -1, materials));
  addBrokenPiers(hall, count, materials);

  // Warm light filters through a broken opening above the first landing.
  box(hall, 3.0, 0.14, length * 0.92, -5.2, 7.9, (frontZ + backZ) / 2, materials.darkTimber);
  for (const side of [-1, 1]) {
    for (const z of [firstZ + 5, last.z - 3]) {
      const fracturedBeam = box(hall, 3.7, 0.3, 0.38, side * 3.65,
        Math.max(4.2, stationPlacement(Math.max(0, count - 1)).landingY + 4.4), z, materials.stone);
      fracturedBeam.rotation.z = side * 0.04;
    }
  }
  addDust(hall, backZ, frontZ, last.landingY + 6);
  hall.add(buildGalleryLighting(count));
  return hall;
}
