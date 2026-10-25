import {
  BufferAttribute, BufferGeometry, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import {
  PEDESTAL_HEIGHT, RIVER_WALKWAY_THICKNESS, RIVER_WALKWAY_WIDTH, stationPlacement,
} from "./layout";
import { riverBankNormalAt, riverPointAt } from "./riverPath";
import { riverRibbonEndForStationCount, RIVER_RIBBON_SAMPLES, RIVER_RIBBON_START_DISTANCE } from "./particleRiver";

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

function addCase(group: Group, x: number, z: number, walkY: number,
  yaw: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const width = 2.15;
  const depth = 1.82;
  const height = 2.28;
  const rail = 0.018;
  const baseY = walkY + PEDESTAL_HEIGHT;
  const midY = baseY + height / 2;
  const caseRoot = new Group();
  caseRoot.position.set(x, 0, z);
  caseRoot.rotation.y = yaw;
  group.add(caseRoot);
  const pane = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), materials.glass);
    mesh.position.set(px, py, pz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.pickThrough = true;
    mesh.raycast = () => undefined;
    caseRoot.add(mesh);
  };
  pane(width - rail, height, 0.008, 0, midY, depth / 2);
  pane(width - rail, height, 0.008, 0, midY, -depth / 2);
  pane(0.008, height, depth - rail, -width / 2, midY, 0);
  pane(0.008, height, depth - rail, width / 2, midY, 0);
  pane(width - rail, 0.008, depth - rail, 0, baseY + height, 0);

  const halfW = width / 2;
  const halfD = depth / 2;
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    bar(caseRoot, materials.bronze, rail, height, rail, sideX * (halfW - rail / 2), midY,
      sideZ * (halfD - rail / 2));
  }
  for (const sideZ of [-1, 1]) {
    bar(caseRoot, materials.bronze, width, rail, rail, 0, baseY + rail / 2, sideZ * (halfD - rail / 2));
    bar(caseRoot, materials.bronze, width, rail, rail, 0, baseY + height - rail / 2,
      sideZ * (halfD - rail / 2));
  }
  for (const sideX of [-1, 1]) {
    bar(caseRoot, materials.bronze, rail, rail, depth, sideX * (halfW - rail / 2), baseY + rail / 2, 0);
    bar(caseRoot, materials.bronze, rail, rail, depth, sideX * (halfW - rail / 2),
      baseY + height - rail / 2, 0);
  }

  const pedestal = new Mesh(new CylinderGeometry(0.72, 0.82, PEDESTAL_HEIGHT, 56), materials.stone);
  pedestal.position.set(x, walkY + PEDESTAL_HEIGHT / 2, z);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pedestal.userData.pickThrough = true;
  caseRoot.add(pedestal);
  const rim = new Mesh(new TorusGeometry(0.72, 0.018, 8, 56), materials.bronze);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, baseY, 0);
  rim.raycast = () => undefined;
  rim.userData.pickThrough = true;
  caseRoot.add(rim);
}

function createWalkwayGeometry(count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  const start = RIVER_RIBBON_START_DISTANCE;
  const end = riverRibbonEndForStationCount(count);
  const positions = new Float32Array((RIVER_RIBBON_SAMPLES + 1) * 4 * 3);
  const uvs = new Float32Array((RIVER_RIBBON_SAMPLES + 1) * 4 * 2);
  const indices: number[] = [];
  for (let row = 0; row <= RIVER_RIBBON_SAMPLES; row += 1) {
    const t = row / RIVER_RIBBON_SAMPLES;
    const distance = start + t * (end - start);
    const center = riverPointAt(distance);
    const bank = riverBankNormalAt(distance);
    const vertices = [
      [center.x - bank.x * RIVER_WALKWAY_WIDTH / 2, center.y, center.z - bank.z * RIVER_WALKWAY_WIDTH / 2],
      [center.x + bank.x * RIVER_WALKWAY_WIDTH / 2, center.y, center.z + bank.z * RIVER_WALKWAY_WIDTH / 2],
      [center.x - bank.x * RIVER_WALKWAY_WIDTH / 2, center.y - RIVER_WALKWAY_THICKNESS,
        center.z - bank.z * RIVER_WALKWAY_WIDTH / 2],
      [center.x + bank.x * RIVER_WALKWAY_WIDTH / 2, center.y - RIVER_WALKWAY_THICKNESS,
        center.z + bank.z * RIVER_WALKWAY_WIDTH / 2],
    ];
    for (let vertex = 0; vertex < vertices.length; vertex += 1) {
      const [x, y, z] = vertices[vertex]!;
      const offset = (row * 4 + vertex) * 3;
      positions.set([x, y, z], offset);
      const uvOffset = (row * 4 + vertex) * 2;
      uvs.set([t, vertex % 2], uvOffset);
    }
    if (row === RIVER_RIBBON_SAMPLES) continue;
    const a = row * 4;
    const b = a + 4;
    indices.push(
      a, a + 1, b, a + 1, b + 1, b,
      a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
      a, b, a + 2, a + 2, b, b + 2,
      a + 1, a + 3, b + 1, a + 3, b + 3, b + 1,
    );
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addWalkway(group: Group, count: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const walkway = new Mesh(createWalkwayGeometry(count), materials.stone);
  walkway.name = "galaxy-river-walkway";
  walkway.receiveShadow = true;
  walkway.castShadow = true;
  walkway.raycast = () => undefined;
  group.add(walkway);
}

/** A continuous, gently rising S-shaped river carries one glass case at every bend. */
export function buildGallery(count: number): Group {
  const gallery = new Group();
  gallery.name = "sinuous-galaxy-river-gallery";
  const materials = createGalleryMaterials();
  addWalkway(gallery, count, materials);
  for (let index = 0; index < count; index += 1) {
    const placement = stationPlacement(index);
    const inwardX = -placement.side * placement.bankX;
    const inwardZ = -placement.side * placement.bankZ;
    addCase(gallery, placement.x, placement.z, placement.walkY,
      Math.atan2(inwardX, inwardZ), materials);
  }
  gallery.add(buildGalleryLighting(count));
  return gallery;
}
