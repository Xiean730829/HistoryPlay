import {
  ACESFilmicToneMapping, Box3, Group, Mesh, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
  PMREMGenerator, BoxGeometry, MeshBasicMaterial, type WebGLRenderTarget,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { ActiveSession, ArtifactProjection } from "../application/museumApi";
import { galleryAssets } from "../capabilities/galleryAssets";
import type { AssetLease } from "../capabilities/assetLoader";
import { buildGallery } from "./architecture";
import { MODEL_SURFACE_OFFSET, maintainSurfaceContact, nearbyModelIndices, seatModel, stationPlacement } from "./layout";
import { routeCameraPose, stationFacingYaw } from "./routeCamera";
import { disposeTree } from "./resources";
import { pickArtifact } from "./picking";
import { galleryVisualTheme } from "./visualTheme";
import { ParticleRiver, type GalleryEnvironment } from "./particleRiver";

interface Exhibit { root: Group; spin: Group; loaded: boolean; loading: boolean; controller: AbortController; lease?: AssetLease }
interface WorldHooks {
  onSelect(id: string): void;
  onObserve(yaw: number, pitch: number, zoom: number): void;
  onPick(id: string | null): void;
  onLoaded(count: number): void;
  onRender(status: "rendered" | "degraded", reason?: string): void;
}

/** One WebGL world owns the hall, actual GLBs, camera and their GPU lifetime. */
export class MuseumWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(47, 1, 0.08, 100);
  readonly renderer: WebGLRenderer;
  private readonly exhibits = new Map<string, Exhibit>();
  private readonly targetPosition = new Vector3().fromArray(routeCameraPose(0, false).position);
  private readonly targetLook = new Vector3().fromArray(routeCameraPose(0, false).lookAt);
  private readonly currentLook = this.targetLook.clone();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private frame = 0;
  private disposed = false;
  private latest: ActiveSession;
  private acknowledged = "";
  private acknowledgedAt = 0;
  private readonly resize: ResizeObserver;
  private readonly environment: WebGLRenderTarget;
  private readonly river: ParticleRiver;
  private lastTime = 0;
  private inspection = false;
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private preview: { yaw: number; pitch: number } | null = null;
  private routePosition = 0;
  private targetRoutePosition = 0;
  private suppressClick = false;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelFactor = 1;

  constructor(private readonly host: HTMLElement, private readonly artifacts: readonly ArtifactProjection[],
    session: ActiveSession, private readonly hooks: WorldHooks) {
    this.latest = session;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, galleryVisualTheme.renderer.pixelRatioLimit));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = galleryVisualTheme.renderer.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute("aria-label", "沿蜿蜒银河河道上行的三维文物展廊");
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);
    this.scene.background = null;
    const environment = new RoomEnvironment();
    const generator = new PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(environment, 0.04);
    this.scene.environment = this.environment.texture;
    environment.dispose(); generator.dispose();
    this.river = new ParticleRiver(artifacts.length);
    this.scene.add(this.river.group);
    this.scene.add(buildGallery(artifacts.length));
    this.camera.position.copy(this.targetPosition);
    this.camera.lookAt(this.currentLook);
    artifacts.forEach((artifact, index) => this.createExhibit(artifact, index));
    this.resize = new ResizeObserver(() => this.fit()); this.resize.observe(host); this.fit();
    this.renderer.domElement.addEventListener("click", this.click);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerCancel);
    this.renderer.domElement.addEventListener("wheel", this.wheel, { passive: false });
    this.frame = requestAnimationFrame(this.animate);
  }

  private fit(): void {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.camera.fov = width < 650 ? 62 : 47; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private createExhibit(artifact: ArtifactProjection, index: number): void {
    const p = stationPlacement(index);
    const root = new Group(); root.position.set(p.x, p.plinthTop + MODEL_SURFACE_OFFSET, p.z);
    root.rotation.y = stationFacingYaw(index);
    root.userData.artifactId = artifact.id;
    const spin = new Group(); root.add(spin); this.scene.add(root);
    const entry: Exhibit = { root, spin, loaded: false, loading: false, controller: new AbortController() };
    this.exhibits.set(artifact.id, entry);
    // A case-sized target catches the coin hole and the supporting plinth as one exhibit.
    const pickVolume = new Mesh(new BoxGeometry(2.5, 2.5, 2.15), new MeshBasicMaterial({ visible: false }));
    pickVolume.position.set(p.x, p.plinthTop + 1.24, p.z); pickVolume.userData.artifactId = artifact.id;
    this.scene.add(pickVolume);
  }

  private async loadModel(artifact: ArtifactProjection, entry: Exhibit): Promise<void> {
    const assetId = artifact.presentation?.display?.asset_id;
    if (!assetId || artifact.presentation?.display?.kind !== "model3d") return;
    const controller = entry.controller; entry.loading = true;
    try {
      const lease = await galleryAssets.acquire(this.latest, assetId, "model", controller.signal);
      if (this.disposed || controller.signal.aborted || entry.controller !== controller) { lease.release(); return; }
      entry.lease = lease;
      const gltf = await new GLTFLoader().loadAsync(lease.url);
      if (this.disposed || controller.signal.aborted || entry.controller !== controller) { disposeTree(gltf.scene); lease.release(); return; }
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
      if (!this.disposed && !controller.signal.aborted && entry.controller === controller) {
        this.hooks.onRender("degraded", "三维文物加载失败，当前展台为空，未用图片冒充模型");
      }
    } finally {
      if (entry.controller === controller) entry.loading = false;
    }
  }

  update(session: ActiveSession, inspection: boolean): void {
    if (this.latest.state.revision !== session.state.revision || this.latest.state.view_revision !== session.state.view_revision) this.preview = null;
    this.latest = session;
    this.inspection = inspection;
    const index = this.artifacts.findIndex((item) => item.id === session.state.focused_entity_id);
    if (index < 0) return;
    this.targetRoutePosition = index;
    const near = nearbyModelIndices(this.artifacts.length, index);
    this.artifacts.forEach((artifact, itemIndex) => {
      const entry = this.exhibits.get(artifact.id)!;
      if (near.has(itemIndex)) {
        if (!entry.loaded && !entry.loading) void this.loadModel(artifact, entry);
      } else if (entry.loaded || entry.loading) {
        entry.controller.abort(); entry.lease?.release(); entry.lease = undefined;
        disposeTree(entry.spin); entry.loaded = false; entry.loading = false;
        entry.controller = new AbortController();
      }
    });
    const cameraPose = routeCameraPose(index, inspection, session.state.camera_pose?.zoom ?? 1);
    this.targetPosition.fromArray(cameraPose.position);
    this.targetLook.fromArray(cameraPose.lookAt);
  }

  setEnvironment(mode: GalleryEnvironment): void { this.river.setMode(mode); }

  private click = (event: MouseEvent): void => {
    if (this.suppressClick) { this.suppressClick = false; return; }
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const artifact = pickArtifact(this.raycaster, this.scene.children);
    this.hooks.onPick(artifact);
    if (artifact) this.hooks.onSelect(artifact);
  };

  private pointerDown = (event: PointerEvent): void => {
    if (!this.inspection || event.button !== 0) return;
    this.suppressClick = false;
    this.drag = { x: event.clientX, y: event.clientY, yaw: 0, pitch: 0 };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const yaw = (event.clientX - this.drag.x) * -0.42;
    const pitch = (event.clientY - this.drag.y) * 0.22;
    this.drag.yaw = yaw; this.drag.pitch = pitch;
    const pose = this.latest.state.camera_pose;
    this.preview = { yaw: (pose?.yaw ?? 0) + yaw, pitch: Math.max(-45, Math.min(45, (pose?.pitch ?? 0) + pitch)) };
  };
  private pointerUp = (): void => {
    if (!this.drag) return;
    const { yaw, pitch } = this.drag; this.drag = null;
    if (Math.hypot(yaw / 0.42, pitch / 0.22) > 8) {
      this.suppressClick = true; this.hooks.onObserve(yaw, pitch, 1);
    }
    this.preview = null;
  };
  private pointerCancel = (): void => { this.drag = null; this.preview = null; };
  private wheel = (event: WheelEvent): void => {
    if (!this.inspection) return;
    event.preventDefault();
    this.wheelFactor *= event.deltaY < 0 ? 1.12 : 1 / 1.12;
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.hooks.onObserve(0, 0, this.wheelFactor); this.wheelFactor = 1; this.wheelTimer = null;
    }, 160);
  };

  private animate = (time: number): void => {
    if (this.disposed) return;
    if (this.latest.state.mode === "story") {
      this.frame = requestAnimationFrame(this.animate); this.lastTime = time; return;
    }
    const dt = Math.min((time - (this.lastTime || time)) / 1000, 0.05); this.lastTime = time;
    const easing = 1 - Math.exp(-dt * 5.5);
    if (!this.inspection) {
      this.routePosition += (this.targetRoutePosition - this.routePosition) * easing;
      const route = routeCameraPose(this.routePosition, false);
      this.targetPosition.fromArray(route.position);
      this.targetLook.fromArray(route.lookAt);
    }
    this.camera.position.lerp(this.targetPosition, easing);
    this.currentLook.lerp(this.targetLook, easing); this.camera.lookAt(this.currentLook);
    this.river.update(time);
    const state = this.latest.state;
    const entry = state.focused_entity_id ? this.exhibits.get(state.focused_entity_id) : null;
    if (entry) {
      const yaw = -(this.preview?.yaw ?? state.camera_pose?.yaw ?? 0) * Math.PI / 180;
      const pitch = (this.preview?.pitch ?? state.camera_pose?.pitch ?? 0) * Math.PI / 180;
      entry.spin.rotation.y += Math.atan2(Math.sin(yaw - entry.spin.rotation.y), Math.cos(yaw - entry.spin.rotation.y)) * easing;
      entry.spin.rotation.x += (pitch - entry.spin.rotation.x) * easing;
      if (entry.loaded) maintainSurfaceContact(entry.spin, entry.root.position.y);
    }
    this.renderer.render(this.scene, this.camera);
    const receiptKey = `${state.revision}:${state.view_revision}:${state.interaction_epoch}`;
    const yawError = entry ? Math.atan2(Math.sin(entry.spin.rotation.y + (state.camera_pose?.yaw ?? 0) * Math.PI / 180), Math.cos(entry.spin.rotation.y + (state.camera_pose?.yaw ?? 0) * Math.PI / 180)) : 1;
    if (!this.preview && !this.drag && state.mode === "explore" && entry?.loaded && Math.abs(yawError) < 0.01
      && Math.abs(entry.spin.rotation.x - (state.camera_pose?.pitch ?? 0) * Math.PI / 180) < 0.01
      && (this.acknowledged !== receiptKey || time - this.acknowledgedAt > 1000) && this.camera.position.distanceTo(this.targetPosition) < 0.015
      && this.currentLook.distanceTo(this.targetLook) < 0.015 && this.host.getBoundingClientRect().height > 0) {
      const bounds = new Box3().setFromObject(entry.spin);
      const center = bounds.getCenter(new Vector3()).project(this.camera);
      if (Math.abs(center.x) < 1 && Math.abs(center.y) < 1 && center.z > -1 && center.z < 1) {
        this.acknowledged = receiptKey; this.acknowledgedAt = time; this.hooks.onRender("rendered");
      }
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resize.disconnect();
    this.renderer.domElement.removeEventListener("click", this.click);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerCancel);
    this.renderer.domElement.removeEventListener("wheel", this.wheel);
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.exhibits.forEach((entry) => { entry.controller.abort(); entry.lease?.release(); });
    this.river.dispose(); disposeTree(this.scene); this.environment.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
