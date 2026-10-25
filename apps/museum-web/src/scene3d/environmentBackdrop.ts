import {
  BackSide, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, Points, PointsMaterial, SRGBColorSpace, Texture, TextureLoader,
  Vector3,
} from "three";

export type GalleryEnvironment = "ruins" | "stars";

const IMAGE_PATHS: Record<GalleryEnvironment, string> = {
  ruins: "/gallery-environments/ruins-amber-distant-v1.png",
  stars: "/gallery-environments/stars-deep-indigo-v1.png",
};

/** Curved image backdrop. It remains behind, and separate from, the real WebGL hall. */
export class EnvironmentBackdrop {
  readonly group = new Group();
  private readonly wall: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  private readonly textures = new Map<GalleryEnvironment, Texture>();
  private readonly loader = new TextureLoader();
  private mode: GalleryEnvironment = "ruins";
  private request = 0;
  private disposed = false;

  constructor() {
    // 143 degrees around the forward view: wide cinematic environment, not a 360° wrap.
    const geometry = new CylinderGeometry(28, 28, 39.4, 96, 1, true, Math.PI * 1.1, Math.PI * 0.8);
    const material = new MeshBasicMaterial({
      side: BackSide, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
      color: "#ffffff",
    });
    this.wall = new Mesh(geometry, material);
    this.wall.renderOrder = -1000;
    this.wall.raycast = () => undefined;
    this.group.add(this.wall);
    this.stars = this.makeStars();
    this.stars.visible = false;
    this.group.add(this.stars);
    this.load(this.mode);
  }

  setMode(mode: GalleryEnvironment): void {
    if (this.disposed || this.mode === mode) return;
    this.mode = mode;
    this.stars.visible = mode === "stars";
    this.load(mode);
  }

  update(anchor: Vector3): void {
    this.group.position.set(anchor.x, anchor.y + 5, anchor.z);
  }

  dispose(): void {
    this.disposed = true;
    this.request += 1;
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
    this.wall.geometry.dispose();
    this.wall.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
  }

  private load(mode: GalleryEnvironment): void {
    const cached = this.textures.get(mode);
    if (cached) { this.wall.material.map = cached; this.wall.material.needsUpdate = true; return; }
    const request = ++this.request;
    this.loader.load(IMAGE_PATHS[mode], (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      this.textures.set(mode, texture);
      if (request === this.request && this.mode === mode) {
        this.wall.material.map = texture;
        this.wall.material.needsUpdate = true;
      }
    }, undefined, () => {
      // Keep the dark fallback and procedural stars if a later deployment omits an image.
    });
  }

  private makeStars(): Points<BufferGeometry, PointsMaterial> {
    const positions = new Float32Array(220 * 3);
    let seed = 94217;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
    for (let index = 0; index < 220; index += 1) {
      const theta = Math.PI * 1.14 + random() * Math.PI * 0.72;
      const y = (random() - 0.5) * 33;
      positions[index * 3] = Math.sin(theta) * 27.6;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = Math.cos(theta) * 27.6;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const points = new Points(geometry, new PointsMaterial({
      color: "#9daed3", size: 0.075, transparent: true, opacity: 0.72,
      sizeAttenuation: true, depthWrite: false, depthTest: false, toneMapped: false,
    }));
    points.renderOrder = -999;
    points.raycast = () => undefined;
    return points;
  }
}
