import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Points,
  PointsMaterial,
} from "three";

export type GalleryEnvironment = "ruins" | "stars";

const PALETTES: Record<GalleryEnvironment, readonly string[]> = {
  stars: ["#f2f5ff", "#c9d1ff", "#a9a3ee", "#dcb4ee", "#f5d5ae", "#788bbd"],
  ruins: ["#ffe5ab", "#f4c36f", "#df9b54", "#f6d782", "#ca805c", "#fff0c9"],
};

/** Stable 3D particles form a near-wide, far-narrow route. Only their light gently breathes. */
export class ParticleRiver {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly material = new PointsMaterial({
    color: "#ffffff", size: 0.055, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.66, depthWrite: false, depthTest: true,
    blending: AdditiveBlending, toneMapped: false,
  });
  private readonly points: Points<BufferGeometry, PointsMaterial>;
  private readonly hues: number[] = [];
  private mode: GalleryEnvironment;
  private disposed = false;

  constructor(mode: GalleryEnvironment = "ruins") {
    this.mode = mode;
    const count = 4200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let seed = 735021;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let index = 0; index < count; index += 1) {
      const depth = random();
      const z = 14 - depth * 108;
      const width = 0.12 + 6.1 * Math.pow(1 - depth, 1.22);
      // A triangular distribution gives the river a bright core and feathered banks.
      const cross = random() + random() - 1;
      const x = cross * width;
      const y = 0.035 + Math.pow(random(), 3) * (0.12 + width * 0.04);
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      this.hues.push(random());
    }

    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setAttribute("color", new BufferAttribute(colors, 3));
    this.recolor();
    this.points = new Points(this.geometry, this.material);
    this.points.name = "stable-galaxy-river-particles";
    this.points.renderOrder = 1;
    this.points.raycast = () => undefined;
    this.group.add(this.points);
  }

  setMode(mode: GalleryEnvironment): void {
    if (this.disposed || this.mode === mode) return;
    this.mode = mode;
    this.recolor();
  }

  update(timeMs: number): void {
    if (!this.disposed) this.material.opacity = 0.64 + Math.sin(timeMs * 0.00045) * 0.025;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }

  private recolor(): void {
    const attribute = this.geometry.getAttribute("color");
    if (!(attribute instanceof BufferAttribute)) return;
    const palette = PALETTES[this.mode].map((value) => new Color(value));
    for (let index = 0; index < this.hues.length; index += 1) {
      const hue = this.hues[index] ?? 0;
      const color = palette[Math.min(palette.length - 1, Math.floor(hue * palette.length))]!;
      attribute.setXYZ(index, color.r, color.g, color.b);
    }
    attribute.needsUpdate = true;
  }
}
