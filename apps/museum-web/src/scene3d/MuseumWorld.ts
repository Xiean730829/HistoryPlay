import {
  ACESFilmicToneMapping, Box3, Color, FogExp2, Group, Mesh, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import type { AssetLease } from "../capabilities/assetLoader";
import { buildHall, inscription } from "./architecture";
import { seatModel, stationPlacement } from "./layout";
import { disposeTree } from "./resources";

interface Exhibit { root: Group; spin: Group; loaded: boolean; controller: AbortController; lease?: AssetLease }
interface WorldHooks {
  onSelect(id: string): void;
  onLoaded(count: number): void;
  onRender(status: "rendered" | "degraded", reason?: string): void;
}

/** One WebGL world owns the hall, actual GLBs, camera and their GPU lifetime. */
export class MuseumWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(47, 1, 0.08, 100);
  readonly renderer: WebGLRenderer;
  private readonly exhibits = new Map<string, Exhibit>();
  private readonly targetPosition = new Vector3(0.4, 2.5, 8.4);
  private readonly targetLook = new Vector3(0, 1.65, -8);
  private readonly currentLook = this.targetLook.clone();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private frame = 0;
  private disposed = false;
  private latest: ActiveSession;
  private acknowledged = "";
  private readonly resize: ResizeObserver;
  private lastTime = 0;

  constructor(private readonly host: HTMLElement, private readonly artifacts: readonly ArtifactProjection[],
    session: ActiveSession, private readonly hooks: WorldHooks) {
    this.latest = session;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "可点击文物的三维宫殿展廊");
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color("#b3a086");
    this.scene.fog = new FogExp2("#8a7961", 0.018);
    this.scene.add(buildHall(artifacts.length));
    this.camera.position.copy(this.targetPosition);
    this.camera.lookAt(this.currentLook);
    artifacts.forEach((artifact, index) => this.createExhibit(artifact, index));
    this.resize = new ResizeObserver(() => this.fit()); this.resize.observe(host); this.fit();
    this.renderer.domElement.addEventListener("click", this.click);
    this.frame = requestAnimationFrame(this.animate);
  }

  private fit(): void {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private createExhibit(artifact: ArtifactProjection, index: number): void {
    const p = stationPlacement(index);
    const root = new Group(); root.position.set(p.x, p.top + 0.04, p.z);
    root.userData.artifactId = artifact.id;
    const spin = new Group(); root.add(spin); this.scene.add(root);
    const entry: Exhibit = { root, spin, loaded: false, controller: new AbortController() };
    this.exhibits.set(artifact.id, entry);
    const label = inscription(artifact.title, 2.1, 0.4);
    label.position.set(p.x, 0.76, p.z + 0.895); this.scene.add(label);
    const date = inscription(artifact.time_range.display_label ?? `${artifact.time_range.start_year}年`, 2.3, 0.6, true);
    date.position.set(p.x * 0.6, 0.017, p.z + 1.65); this.scene.add(date);
    // Three display GLBs fit in the initial slice. Future halls keep at most three close models.
    if (index < 3) void this.loadModel(artifact, entry);
  }

  private async loadModel(artifact: ArtifactProjection, entry: Exhibit): Promise<void> {
    const assetId = artifact.presentation?.display?.asset_id;
    if (!assetId || artifact.presentation?.display?.kind !== "model3d") return;
    try {
      const lease = await galleryAssets.acquire(this.latest, assetId, "model", entry.controller.signal);
      entry.lease = lease;
      const gltf = await new GLTFLoader().loadAsync(lease.url);
      if (this.disposed || entry.controller.signal.aborted) { disposeTree(gltf.scene); return; }
      const model = gltf.scene;
      const preset = artifact.presentation?.default_camera?.orbit;
      if (preset === "inscription-face") model.rotateY(-Math.PI / 2);
      if (preset === "three-quarter") model.rotateY(0.3);
      model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true; object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof MeshStandardMaterial) material.envMapIntensity = 0.6;
        }
      });
      const seated = seatModel(model, preset === "inscription-face" ? 1.3 : 1.75, 1.9);
      entry.spin.add(seated); entry.loaded = true;
      this.hooks.onLoaded([...this.exhibits.values()].filter((item) => item.loaded).length);
    } catch {
      if (!this.disposed && !entry.controller.signal.aborted) {
        this.hooks.onRender("degraded", "三维文物加载失败，当前展台为空，未用图片冒充模型");
      }
    }
  }

  update(session: ActiveSession, inspection: boolean): void {
    this.latest = session;
    const index = this.artifacts.findIndex((item) => item.id === session.state.focused_entity_id);
    if (index < 0) return;
    const p = stationPlacement(index);
    if (inspection) {
      this.targetPosition.set(p.x + 0.15, 2.0, p.z + 3.05 / Math.sqrt(session.state.camera_pose?.zoom ?? 1));
      this.targetLook.set(p.x, 1.8, p.z);
    } else {
      this.targetPosition.set(0.35, 2.45, Math.min(8.4, p.z + 10.4));
      this.targetLook.set(0, 1.65, p.z - 6);
    }
  }

  private click = (event: MouseEvent): void => {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    let object: Object3D | null = hits[0]?.object ?? null;
    while (object && !object.userData.artifactId) object = object.parent;
    if (object?.userData.artifactId) this.hooks.onSelect(object.userData.artifactId as string);
  };

  private animate = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min((time - (this.lastTime || time)) / 1000, 0.05); this.lastTime = time;
    const easing = 1 - Math.exp(-dt * 5.5);
    this.camera.position.lerp(this.targetPosition, easing);
    this.currentLook.lerp(this.targetLook, easing); this.camera.lookAt(this.currentLook);
    const state = this.latest.state;
    const entry = state.focused_entity_id ? this.exhibits.get(state.focused_entity_id) : null;
    if (entry) {
      const yaw = -(state.camera_pose?.yaw ?? 0) * Math.PI / 180;
      const pitch = (state.camera_pose?.pitch ?? 0) * Math.PI / 180;
      entry.spin.rotation.y += Math.atan2(Math.sin(yaw - entry.spin.rotation.y), Math.cos(yaw - entry.spin.rotation.y)) * easing;
      entry.spin.rotation.x += (pitch - entry.spin.rotation.x) * easing;
    }
    this.renderer.render(this.scene, this.camera);
    const receiptKey = `${state.revision}:${state.view_revision}:${state.interaction_epoch}`;
    const yawError = entry ? Math.atan2(Math.sin(entry.spin.rotation.y + (state.camera_pose?.yaw ?? 0) * Math.PI / 180), Math.cos(entry.spin.rotation.y + (state.camera_pose?.yaw ?? 0) * Math.PI / 180)) : 1;
    if (entry?.loaded && Math.abs(yawError) < 0.01
      && Math.abs(entry.spin.rotation.x - (state.camera_pose?.pitch ?? 0) * Math.PI / 180) < 0.01
      && this.acknowledged !== receiptKey && this.camera.position.distanceTo(this.targetPosition) < 0.015
      && this.currentLook.distanceTo(this.targetLook) < 0.015 && this.host.getBoundingClientRect().height > 0) {
      const bounds = new Box3().setFromObject(entry.spin);
      const center = bounds.getCenter(new Vector3()).project(this.camera);
      if (Math.abs(center.x) < 1 && Math.abs(center.y) < 1 && center.z > -1 && center.z < 1) {
        this.acknowledged = receiptKey; this.hooks.onRender("rendered");
      }
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resize.disconnect();
    this.renderer.domElement.removeEventListener("click", this.click);
    this.exhibits.forEach((entry) => { entry.controller.abort(); entry.lease?.release(); });
    disposeTree(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
