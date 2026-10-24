import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, SpotLight, SRGBColorSpace,
} from "three";
import { stationPlacement } from "./layout";

export function inscription(text: string, width = 2, height = 0.5, floor = false): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = "#d9bb78";
  ctx.font = '56px "Songti SC", "SimSun", serif';
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 512, 128, 980);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const plane = new Mesh(new PlaneGeometry(width, height), new MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.8, depthWrite: false }));
  if (floor) plane.rotation.x = -Math.PI / 2;
  return plane;
}

/** Modular architectural geometry: a palace-inspired exhibition, not a site reconstruction. */
export function buildHall(count: number): Group {
  const hall = new Group(); hall.name = "palace-museum-architecture";
  const length = Math.max(26, count * 5.8 + 10);
  const palette = {
    red: new MeshStandardMaterial({ color: "#772a20", roughness: 0.65 }),
    dark: new MeshStandardMaterial({ color: "#29251f", roughness: 0.75 }),
    teal: new MeshStandardMaterial({ color: "#234f4d", roughness: 0.7 }),
    gold: new MeshStandardMaterial({ color: "#ac8a4b", metalness: 0.5, roughness: 0.43 }),
    stone: new MeshStandardMaterial({ color: "#908a7c", roughness: 0.95 }),
    wall: new MeshStandardMaterial({ color: "#d2c0a0", roughness: 1 }),
    plinth: new MeshStandardMaterial({ color: "#413529", roughness: 0.75 }),
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: MeshStandardMaterial) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; hall.add(mesh); return mesh;
  };
  const ground = box(12, 0.2, length + 6, 0, -0.13, -length / 2 + 6, palette.stone);
  ground.name = "stone-floor";
  // Fine joints and alternating quiet stone tones give the floor a physical scale.
  for (let row = 0; row < Math.ceil((length + 6) / 1.5); row++) {
    for (let col = 0; col < 8; col++) {
      const material = palette.stone.clone();
      material.color = new Color().setHSL(0.105, 0.07, 0.34 + ((row * 7 + col * 3) % 5) * 0.018);
      box(1.486, 0.025, 1.486, -5.25 + col * 1.5, -0.012, 8.25 - row * 1.5, material);
    }
  }
  for (const x of [-5.6, 5.6]) {
    box(0.55, 0.75, length, x, 0.36, -length / 2 + 5, palette.stone);
    box(0.3, 1.1, length, x, 4.8, -length / 2 + 5, palette.wall);
    box(0.55, 0.3, length, x, 5.55, -length / 2 + 5, palette.gold);
  }
  for (let z = 7; z > -length + 4; z -= 4.2) {
    for (const x of [-4.85, 4.85]) {
      const column = new Mesh(new CylinderGeometry(0.24, 0.32, 4.8, 18), palette.red);
      column.position.set(x, 2.4, z); column.castShadow = true; hall.add(column);
      box(0.85, 0.23, 0.85, x, 0.13, z, palette.stone);
      box(0.58, 0.18, 0.58, x, 4.58, z, palette.gold);
      box(1.2, 0.18, 0.55, x, 4.84, z, palette.teal);
      box(0.65, 0.18, 1.2, x, 5.02, z, palette.red);
      box(1.5, 0.17, 0.55, x, 5.2, z, palette.gold);
      // Repeated window mullions cast real shadows into the stone aisle.
      for (let offset = 0.3; offset < 3.8; offset += 0.5) {
        box(0.1, 3.3, 0.075, Math.sign(x) * 5.55, 2.5, z - offset, palette.red);
      }
      for (const y of [1.2, 2.1, 3, 4]) box(0.12, 0.07, 4.2, Math.sign(x) * 5.55, y, z - 2.1, palette.red);
    }
    box(10.3, 0.4, 0.4, 0, 5.25, z, palette.red);
    box(10.3, 0.11, 0.5, 0, 5.02, z, palette.teal);
    box(10.2, 0.06, 0.52, 0, 4.94, z, palette.gold);
  }
  // Timber panels, with a central skylight slot rather than a flat image ceiling.
  box(3.9, 0.16, length, -3.05, 5.7, -length / 2 + 5, palette.dark);
  box(3.9, 0.16, length, 3.05, 5.7, -length / 2 + 5, palette.dark);
  box(12, 5.8, 0.4, 0, 2.8, -length + 5, palette.red);
  box(4, 3.6, 0.2, 0, 1.8, -length + 5.3, palette.dark);
  const endSign = inscription("大 唐 · 时 间 之 廊", 4.6, 1.15);
  endSign.position.set(0, 4.3, -length + 5.55); hall.add(endSign);
  for (let i = 0; i < count; i++) {
    const { x, z, top } = stationPlacement(i);
    box(2.12, top, 1.75, x, top / 2, z, palette.plinth);
    box(2.2, 0.075, 1.83, x, top, z, palette.gold);
    box(2.27, 0.1, 1.9, x, 0.05, z, palette.dark);
    const light = new SpotLight("#ffe6b6", 28, 12, 0.42, 0.65, 1.7);
    light.position.set(x + 0.6, 4.7, z + 1.3); light.target.position.set(x, 1.3, z);
    hall.add(light, light.target);
  }
  hall.add(new HemisphereLight("#e5eeef", "#806244", 2.1));
  const sun = new DirectionalLight("#ffdfac", 3.2);
  sun.position.set(-7, 11, 5); sun.target.position.set(1, 0, -9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 17, bottom: -17, far: 45 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.025;
  hall.add(sun, sun.target);
  return hall;
}
