import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  Points, PointsMaterial, Texture, TextureLoader, Vector3,
  ClampToEdgeWrapping, SRGBColorSpace,
} from "three";
import {
  RIVER_STATION_SPACING, riverBankNormalAt, riverHeightAt, riverPointAt, riverStationDistance,
} from "./riverPath";

export type GalleryEnvironment = "stars";
const STAR_RIVER_TEXTURE = "/gallery-environments/galaxy-emission-ribbon-v1.png";
export const RIVER_RIBBON_START_DISTANCE = -12;
export const RIVER_RIBBON_SAMPLES = 480;

export function riverRibbonEndForStationCount(stationCount: number): number {
  const lastStation = Math.max(0, Math.floor(stationCount) - 1);
  return Math.max(
    RIVER_RIBBON_START_DISTANCE + RIVER_STATION_SPACING,
    riverStationDistance(lastStation) + RIVER_STATION_SPACING / 2,
  );
}

export function createRibbonGeometry(
  width: number,
  samples = RIVER_RIBBON_SAMPLES,
  stationCount = 19,
  heightOffset = 0.025,
): BufferGeometry {
  const geometry = new BufferGeometry();
  const riverEnd = riverRibbonEndForStationCount(stationCount);
  const positions = new Float32Array((samples + 1) * 2 * 3);
  const uvs = new Float32Array((samples + 1) * 2 * 2);
  const indices: number[] = [];
  for (let row = 0; row <= samples; row += 1) {
    const t = row / samples;
    const distance = RIVER_RIBBON_START_DISTANCE + t * (riverEnd - RIVER_RIBBON_START_DISTANCE);
    const center = riverPointAt(distance);
    const bank = riverBankNormalAt(distance);
    for (let edge = 0; edge < 2; edge += 1) {
      const side = edge === 0 ? -1 : 1;
      const offset = side * width / 2;
      const vertex = row * 2 + edge;
      positions[vertex * 3] = center.x + bank.x * offset;
      positions[vertex * 3 + 1] = center.y + heightOffset;
      positions[vertex * 3 + 2] = center.z + bank.z * offset;
      uvs[vertex * 2] = t;
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

/** The generated galaxy image follows the same S-curve as the walkway, bays and visitor camera. */
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

  constructor(stationCount = 3) {
    this.group.name = "textured-galaxy-river";
    this.texture = new TextureLoader().load(STAR_RIVER_TEXTURE);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.repeat.set(1, 1);
    this.texture.needsUpdate = true;
    this.baseGeometry = createRibbonGeometry(4.8, RIVER_RIBBON_SAMPLES, stationCount, 0.045);
    this.group.add(ribbon(this.baseGeometry, "#d7c6ff", 0.8, this.texture));
    this.group.add(ribbon(createRibbonGeometry(2.15, RIVER_RIBBON_SAMPLES, stationCount, 0.07), "#7d82ff", 0.13));
    this.group.add(ribbon(createRibbonGeometry(0.72, RIVER_RIBBON_SAMPLES, stationCount, 0.09), "#ffd58b", 0.12));
    this.buildSparseTwinkles(stationCount);
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

  private buildSparseTwinkles(stationCount: number): void {
    const count = 720;
    const positions = new Float32Array(count * 3);
    let seed = 735021;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
    for (let index = 0; index < count; index += 1) {
      const riverEnd = riverRibbonEndForStationCount(stationCount);
      const distance = RIVER_RIBBON_START_DISTANCE + random() * (riverEnd - RIVER_RIBBON_START_DISTANCE);
      const point = riverPointAt(distance);
      const bank = riverBankNormalAt(distance);
      const offset = (random() - 0.5) * 7.2;
      const p = new Vector3(point.x + bank.x * offset, riverHeightAt(distance) + 0.08 + random() * 0.36,
        point.z + bank.z * offset);
      positions.set(p.toArray(), index * 3);
    }
    this.garnishGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  }
}
