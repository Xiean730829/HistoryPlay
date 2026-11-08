import { AmbientLight, Group, HemisphereLight, PointLight } from "three";
import { stationPlacement } from "./layout";

/** Warm amber pools identify real exhibits along the level horizontal river. */
export function buildGalleryLighting(count: number): Group {
  const rig = new Group();
  rig.name = "gallery-exhibit-lights";
  rig.add(new HemisphereLight("#f6d7a1", "#33271d", 0.8));
  rig.add(new AmbientLight("#e0a45b", 0.24));
  const accents = ["#ffca79", "#f1b65e", "#ffe2a8", "#bd8350"];
  for (let index = 0; index < count; index += 1) {
    const p = stationPlacement(index);
    const light = new PointLight(accents[index % accents.length], 14, 7.5, 2);
    light.position.set(p.x, p.walkY + 3.7, p.z + 1.4);
    rig.add(light);
  }
  return rig;
}
