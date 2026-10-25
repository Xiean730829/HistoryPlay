import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import {
  LANDING_DEPTH, PEDESTAL_HEIGHT, STAIR_STEPS_PER_FLIGHT, STAIR_STEP_RISE,
  STAIR_WIDTH, stairStepPlacement, stationPlacement,
} from "./layout";
import { riverPointAt, riverTangentAt } from "./riverPath";

function pathYawAt(distance: number): number {
  const tangent = riverTangentAt(distance);
  return Math.atan2(-tangent.x, -tangent.z);
}

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

function addCase(group: Group, x: number, z: number, landingY: number,
  yaw: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const width = 2.15;
  const depth = 1.82;
  const height = 2.28;
  const rail = 0.018;
  const baseY = landingY + PEDESTAL_HEIGHT;
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
  pedestal.position.set(x, landingY + PEDESTAL_HEIGHT / 2, z);
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

function addLanding(group: Group, index: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const placement = stationPlacement(index);
  const landing = new Mesh(new BoxGeometry(STAIR_WIDTH + 0.36, 0.22, LANDING_DEPTH), materials.stone);
  landing.name = `stair-landing-${index}`;
  landing.position.set(placement.centerX, placement.landingY - 0.11, placement.centerZ);
  landing.rotation.y = pathYawAt(placement.distance);
  landing.receiveShadow = true;
  landing.castShadow = true;
  landing.raycast = () => undefined;
  group.add(landing);
}

function addStairFlight(group: Group, flightIndex: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  for (let stepIndex = 0; stepIndex < STAIR_STEPS_PER_FLIGHT; stepIndex += 1) {
    const step = stairStepPlacement(flightIndex, stepIndex);
    const center = riverPointAt(step.distance + step.treadDepth / 2);
    const tread = new Mesh(new BoxGeometry(STAIR_WIDTH, step.height, step.treadDepth + 0.012), materials.stone);
    tread.name = `stair-step-${flightIndex}-${stepIndex}`;
    tread.position.set(center.x, flightIndex * STAIR_STEP_RISE * STAIR_STEPS_PER_FLIGHT + step.height / 2,
      center.z);
    tread.rotation.y = pathYawAt(step.distance + step.treadDepth / 2);
    tread.castShadow = true;
    tread.receiveShadow = true;
    tread.raycast = () => undefined;
    group.add(tread);

    const edge = new Mesh(new BoxGeometry(STAIR_WIDTH, 0.022, 0.032), materials.bronze);
    edge.name = `stair-edge-${flightIndex}-${stepIndex}`;
    const edgeCenter = riverPointAt(step.distance + step.treadDepth * 0.94);
    edge.position.set(edgeCenter.x, step.topY - 0.012, edgeCenter.z);
    edge.rotation.y = pathYawAt(step.distance + step.treadDepth / 2);
    edge.raycast = () => undefined;
    group.add(edge);
  }
}

/** A rising central stone stair separates paired amber-lit glass cases on each landing. */
export function buildGallery(count: number): Group {
  const gallery = new Group();
  gallery.name = "ascending-stair-galaxy-gallery";
  const materials = createGalleryMaterials();
  for (let index = 0; index < count; index += 1) {
    addLanding(gallery, index, materials);
    const placement = stationPlacement(index);
    const inwardX = -placement.side * placement.bankX;
    const inwardZ = -placement.side * placement.bankZ;
    addCase(gallery, placement.x, placement.z, placement.landingY,
      Math.atan2(inwardX, inwardZ), materials);
    if (index < count - 1) addStairFlight(gallery, index, materials);
  }
  gallery.add(buildGalleryLighting(count));
  return gallery;
}
