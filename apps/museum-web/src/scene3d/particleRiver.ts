import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  Points, PointsMaterial, Texture, TextureLoader, Vector3,
  RepeatWrapping, SRGBColorSpace,
} from "three";
import { riverBankNormalAt, riverPointAt } from "./riverPath";

export type GalleryEnvironment = "stars";
const STAR_RIVER_TEXTURE = "/gallery-environments/stars-deep-indigo-v1.png";
const RIVER_START = -12;
const RIVER_END = 145;
const RIVER_SAMPLES = 240;

export function createRibbonGeometry(width: number, samples = RIVER_SAMPLES): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array((samples + 1) * 2 * 3);
  const uvs = new Float32Array((samples + 1) * 2 * 2);
  const indices: number[] = [];
  for (let row = 0; row <= samples; row += 1) {
    const t = row / samples;
    const distance = RIVER_START + t * (RIVER_END - RIVER_START);
    const center = riverPointAt(distance);
    const bank = riverBankNormalAt(distance);
    const taper = 0.42 + 0.58 * (1 - t);
    for (let edge = 0; edge < 2; edge += 1) {
      const side = edge === 0 ? -1 : 1;
      const offset = side * width * taper / 2;
      const vertex = row * 2 + edge;
      positions[vertex * 3] = center.x + bank.x * offset;
      positions[vertex * 3 + 1] = 0.025;
      positions[vertex * 3 + 2] = center.z + bank.z * offset;
      uvs[vertex * 2] = t * (RIVER_END - RIVER_START) / 15;
      uvs[vertex * 2 + 1] = edge;
    }
    if (row < samples) {
      const a = row * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ribbon(geometry: BufferGeometry, color: string, opacity: number, map?: Texture): Mesh {
  const material = new MeshBasicMaterial({
    color, map, transparent: true, opacity, depthWrite: false,
    blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = map ? "clean-galaxy-photo-ribbon" : `galaxy-light-layer-${color.slice(1)}`;
  mesh.raycast = () => undefined;
  return mesh;
}

/** Image-textured light ribbon follows the same S-curve as exhibit placement and the visitor camera. */
export class ParticleRiver {
  readonly group = new Group();
  private readonly texture: Texture;
  private readonly baseGeometry: BufferGeometry;
  private readonly garnishGeometry = new BufferGeometry();
  private readonly garnishMaterial = new PointsMaterial({
    color: "#d7d9ff", size: 0.036, sizeAttenuation: true, transparent: true,
    opacity: 0.52, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
  private readonly points: Points<BufferGeometry, PointsMaterial>;
  private disposed = false;

  constructor() {
    this.group.name = "textured-galaxy-river";
    this.texture = new TextureLoader().load(STAR_RIVER_TEXTURE);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = RepeatWrapping;
    this.texture.repeat.set(1, 1);
    this.texture.needsUpdate = true;
    this.baseGeometry = createRibbonGeometry(4.8);
    this.group.add(ribbon(this.baseGeometry, "#d7c6ff", 0.8, this.texture));
    this.group.add(ribbon(createRibbonGeometry(2.15), "#7d82ff", 0.13));
    this.group.add(ribbon(createRibbonGeometry(0.72), "#ffd58b", 0.12));
    this.buildSparseTwinkles();
    this.points = new Points(this.garnishGeometry, this.garnishMaterial);
    this.points.name = "sparse-stable-galaxy-twinkles";
    this.points.raycast = () => undefined;
    this.group.add(this.points);
  }

  setMode(_mode: GalleryEnvironment): void {}

  update(timeMs: number): void {
    if (!this.disposed) this.garnishMaterial.opacity = 0.5 + Math.sin(timeMs * 0.00045) * 0.025;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
    this.baseGeometry.dispose();
    this.garnishGeometry.dispose();
    this.group.traverse((object) => {
      if (object instanceof Mesh && object.geometry !== this.baseGeometry) object.geometry.dispose();
      if ((object as Mesh).material instanceof MeshBasicMaterial) ((object as Mesh).material as MeshBasicMaterial).dispose();
    });
    this.garnishMaterial.dispose();
    this.group.clear();
  }

  private buildSparseTwinkles(): void {
    const count = 720;
    const positions = new Float32Array(count * 3);
    let seed = 735021;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
    for (let index = 0; index < count; index += 1) {
      const distance = RIVER_START + random() * (RIVER_END - RIVER_START);
      const point = riverPointAt(distance);
      const bank = riverBankNormalAt(distance);
      const offset = (random() - 0.5) * 7.2;
      const p = new Vector3(point.x + bank.x * offset, 0.08 + random() * 0.36, point.z + bank.z * offset);
      positions.set(p.toArray(), index * 3);
    }
    this.garnishGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  }
}
