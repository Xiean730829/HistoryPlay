import { DirectionalLight, Group, HemisphereLight, SpotLight } from "three";
import { stationPlacement } from "./layout";
import { galleryVisualTheme } from "./visualTheme";

/** Warm exhibit accents plus a restrained high-side daylight source. */
export function buildGalleryLighting(count: number): Group {
  const rig = new Group(); rig.name = "gallery-lighting-rig";
  const { lighting } = galleryVisualTheme;
  rig.add(new HemisphereLight(lighting.ambientSky, lighting.ambientGround, lighting.ambientIntensity));
  for (let index = 0; index < count; index++) {
    const { x, z, top } = stationPlacement(index);
    const accent = new SpotLight(lighting.exhibit, lighting.exhibitIntensity, 9, 0.52, 0.76, 1.35);
    accent.position.set(x + 0.2, 4.45, z + 1.1);
    accent.target.position.set(x, top + 0.85, z);
    rig.add(accent, accent.target);
  }
  const daylight = new DirectionalLight(lighting.daylight, lighting.daylightIntensity);
  daylight.position.set(-6, 10, 5); daylight.target.position.set(0, 0, -12);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(1536, 1536);
  Object.assign(daylight.shadow.camera, { left: -12, right: 12, top: 16, bottom: -16, near: 0.5, far: 42 });
  daylight.shadow.bias = -0.00015; daylight.shadow.normalBias = 0.03;
  rig.add(daylight, daylight.target);
  return rig;
}
