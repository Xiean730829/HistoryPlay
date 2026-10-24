import { DirectionalLight, Group, HemisphereLight, PointLight, SpotLight } from "three";
import { PLINTH_HEIGHT, stationPlacement } from "./layout";
import { galleryVisualTheme } from "./visualTheme";

/** Warm cabinet accents and a soft shaft of amber light at the far end of the ascent. */
export function buildGalleryLighting(count: number): Group {
  const rig = new Group(); rig.name = "gallery-lighting-rig";
  const { lighting } = galleryVisualTheme;
  rig.add(new HemisphereLight(lighting.ambientSky, lighting.ambientGround, lighting.ambientIntensity));
  for (let index = 0; index < count; index++) {
    const p = stationPlacement(index);
    const target = new Group();
    target.position.set(p.x, p.landingY + PLINTH_HEIGHT + 1.1, p.z);
    const accent = new SpotLight(lighting.exhibit, lighting.exhibitIntensity, 8.5, 0.48, 0.78, 1.6);
    accent.position.set(p.x - Math.sign(p.x) * 0.45, target.position.y + 3.4, p.z + 0.75);
    accent.castShadow = index < 6;
    rig.add(accent, target); accent.target = target;
  }
  const last = stationPlacement(Math.max(0, count - 1));
  const daylight = new DirectionalLight(lighting.daylight, lighting.daylightIntensity);
  daylight.position.set(-6, last.landingY + 11, 7); daylight.target.position.set(0, last.landingY + 2, last.z - 3);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(1536, 1536);
  Object.assign(daylight.shadow.camera, { left: -12, right: 12, top: 16, bottom: -16, near: 0.5, far: 60 });
  daylight.shadow.bias = -0.00015; daylight.shadow.normalBias = 0.03;
  rig.add(daylight, daylight.target);
  const backlight = new PointLight(lighting.backlight, 42, 18, 1.8);
  backlight.position.set(0, last.landingY + 7.5, last.z - 5.6);
  rig.add(backlight);
  return rig;
}
