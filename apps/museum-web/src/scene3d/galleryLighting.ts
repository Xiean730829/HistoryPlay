import { AmbientLight, Group, HemisphereLight, PointLight } from "three";
import { stationPlacement } from "./layout";

/** Small colored pools keep the real exhibits legible without building a lit architectural shell. */
export function buildGalleryLighting(count: number): Group {
  const rig = new Group();
  rig.name = "gallery-exhibit-lights";
  rig.add(new HemisphereLight("#c7d4ff", "#634c38", 1.15));
  rig.add(new AmbientLight("#fff0dc", 0.34));
  const accents = ["#ffd899", "#c4c8ff", "#e4b9d1", "#9dd8d2"];
  for (let index = 0; index < count; index += 1) {
    const p = stationPlacement(index);
    const light = new PointLight(accents[index % accents.length], 17, 7.5, 2);
    light.position.set(p.x - Math.sign(p.x) * 0.45, 3.7, p.z + 0.45);
    rig.add(light);
  }
  return rig;
}
