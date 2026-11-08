import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  Points, PointsMaterial, Texture, TextureLoader, Vector3,
  RepeatWrapping, SRGBColorSpace,
} from "three";
import {
  RIVER_STATION_SPACING, riverBankNormalAt, riverHeightAt, riverPointAt, riverStationDistance,
} from "./riverPath";

export type GalleryEnvironment = "stars";
const STAR_RIVER_TEXTURE = "/gallery-environments/galaxy-emission-ribbon-v1.png";
export const RIVER_RIBBON_START_DISTANCE = -8;
export const RIVER_RIBBON_SAMPLES = 480;
const RIVER_CURVE_TILE = 22;
export const FLOW_SPEED_A = 0.018;
export const FLOW_SPEED_B = 0.011;
const STAR_DRIFT = 0.55;

/** Advance a repeating UV offset without resetting the river when the window moves. */
export function advanceUvOffset(current: number, dt: number, speed: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const next = current + Math.min(dt, 0.05) * speed;
  return next - Math.floor(next);
}

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
  const length = Math.max(1, riverEnd - RIVER_RIBBON_START_DISTANCE);
  const positions = new Float32Array((samples + 1) * 2 * 3);
  const uvs = new Float32Array((samples + 1) * 2 * 2);
  const indices: number[] = [];
  for (let row = 0; row <= samples; row += 1) {
    const t = row / samples;
    const distance = RIVER_RIBBON_START_DISTANCE + t * length;
    const center = riverPointAt(distance);
    const bank = riverBankNormalAt(distance);
    for (let edge = 0; edge < 2; edge += 1) {
      const side = edge === 0 ? -1 : 1;
      const offset = side * width / 2;
      const vertex = row * 2 + edge;
      positions[vertex * 3] = center.x + bank.x * offset;
      positions[vertex * 3 + 1] = center.y + heightOffset;
      positions[vertex * 3 + 2] = center.z + bank.z * offset;
      uvs[vertex * 2] = t * (length / RIVER_CURVE_TILE);
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

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The generated galaxy image follows the same level river as the walkway, bays and visitor camera. */
export class ParticleRiver {
  readonly group = new Group();
  private readonly textureA: Texture;
  private readonly textureB: Texture;
  private readonly baseGeometry: BufferGeometry;
  private readonly flowGeometry: BufferGeometry;
  private readonly garnishGeometry = new BufferGeometry();
  private readonly garnishMaterial = new PointsMaterial({
    color: "#d7d9ff", size: 0.028, sizeAttenuation: true, transparent: true,
    opacity: 0.42, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
  private readonly points: Points<BufferGeometry, PointsMaterial>;
  private readonly starDistances: Float32Array;
  private readonly starOffsets: Float32Array;
  private readonly riverEnd: number;
  private lastTime = 0;
  private flowA = 0;
  private flowB = 0;
  private disposed = false;

  constructor(stationCount = 3) {
    this.group.name = "textured-galaxy-river";
    this.textureA = new TextureLoader().load(STAR_RIVER_TEXTURE);
    this.textureB = this.textureA.clone();
    for (const texture of [this.textureA, this.textureB]) {
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(1, 1);
      texture.needsUpdate = true;
    }
    this.riverEnd = riverRibbonEndForStationCount(stationCount);
    this.baseGeometry = createRibbonGeometry(4.8, RIVER_RIBBON_SAMPLES, stationCount, 0.045);
    this.flowGeometry = createRibbonGeometry(3.4, RIVER_RIBBON_SAMPLES, stationCount, 0.06);
    this.group.add(ribbon(this.baseGeometry, "#d7c6ff", 0.8, this.textureA));
    this.group.add(ribbon(this.flowGeometry, "#9aa6ff", 0.28, this.textureB));
    this.group.add(ribbon(createRibbonGeometry(0.72, RIVER_RIBBON_SAMPLES, stationCount, 0.09), "#ffd58b", 0.12));
    const starCount = 180;
    this.starDistances = new Float32Array(starCount);
    this.starOffsets = new Float32Array(starCount);
    this.buildSparseTwinkles(starCount);
    this.points = new Points(this.garnishGeometry, this.garnishMaterial);
    this.points.name = "sparse-drifting-galaxy-stars";
    this.points.raycast = () => undefined;
    this.group.add(this.points);
  }

  setMode(_mode: GalleryEnvironment): void {}

  update(timeMs: number): void {
    if (this.disposed) return;
    const hidden = typeof document !== "undefined" && document.hidden;
    const reduced = prefersReducedMotion();
    const dt = Math.min(Math.max(0, (timeMs - (this.lastTime || timeMs)) / 1000), 0.05);
    this.lastTime = timeMs;
    if (hidden || reduced || dt === 0) return;
    this.flowA = advanceUvOffset(this.flowA, dt, FLOW_SPEED_A);
    this.flowB = advanceUvOffset(this.flowB, dt, FLOW_SPEED_B);
    this.textureA.offset.x = this.flowA;
    this.textureB.offset.x = -this.flowB;
    const positions = this.garnishGeometry.getAttribute("position");
    const length = this.riverEnd - RIVER_RIBBON_START_DISTANCE;
    for (let index = 0; index < this.starDistances.length; index += 1) {
      let distance = this.starDistances[index]! + dt * STAR_DRIFT;
      if (distance > this.riverEnd) distance = RIVER_RIBBON_START_DISTANCE + (distance - this.riverEnd);
      this.starDistances[index] = distance;
      const point = riverPointAt(distance);
      const bank = riverBankNormalAt(distance);
      const offset = this.starOffsets[index]!;
      positions.setXYZ(
        index,
        point.x + bank.x * offset,
        riverHeightAt(distance) + 0.08 + Math.abs(offset) * 0.04,
        point.z + bank.z * offset,
      );
    }
    void length;
    positions.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.textureA.dispose();
    this.textureB.dispose();
    this.baseGeometry.dispose();
    this.flowGeometry.dispose();
    this.garnishGeometry.dispose();
    this.group.traverse((object) => {
      if (object instanceof Mesh && object.geometry !== this.baseGeometry && object.geometry !== this.flowGeometry) {
        object.geometry.dispose();
      }
      if ((object as Mesh).material instanceof MeshBasicMaterial) ((object as Mesh).material as MeshBasicMaterial).dispose();
    });
    this.garnishMaterial.dispose();
    this.group.clear();
  }

  private buildSparseTwinkles(count: number): void {
    const positions = new Float32Array(count * 3);
    let seed = 735021;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
    for (let index = 0; index < count; index += 1) {
      const distance = RIVER_RIBBON_START_DISTANCE + random() * (this.riverEnd - RIVER_RIBBON_START_DISTANCE);
      this.starDistances[index] = distance;
      this.starOffsets[index] = (random() - 0.5) * 3.4;
      const point = riverPointAt(distance);
      const bank = riverBankNormalAt(distance);
      const offset = this.starOffsets[index]!;
      const p = new Vector3(
        point.x + bank.x * offset,
        riverHeightAt(distance) + 0.08 + random() * 0.18,
        point.z + bank.z * offset,
      );
      positions.set(p.toArray(), index * 3);
    }
    this.garnishGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  }
}
