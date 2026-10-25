import {
  CylinderGeometry, Group, Mesh, TorusGeometry,
} from "three";
import { buildGalleryLighting } from "./galleryLighting";
import { createGalleryMaterials } from "./materialLibrary";
import { stationPlacement } from "./layout";

function addPedestal(group: Group, x: number, z: number, materials: ReturnType<typeof createGalleryMaterials>): void {
  const pedestal = new Mesh(new CylinderGeometry(0.72, 0.82, 0.18, 56), materials.stone);
  pedestal.position.set(x, 0.09, z);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pedestal.userData.pickThrough = true;
  group.add(pedestal);

  const rim = new Mesh(new TorusGeometry(0.72, 0.018, 8, 56), materials.bronze);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(x, 0.18, z);
  rim.raycast = () => undefined;
  rim.userData.pickThrough = true;
  group.add(rim);
}

/** Light circular supports keep each real artifact above the river without a box or rail. */
export function buildGallery(count: number): Group {
  const gallery = new Group();
  gallery.name = "open-gallery-galaxy-river";
  const materials = createGalleryMaterials();
  for (let index = 0; index < count; index += 1) {
    const { x, z } = stationPlacement(index);
    addPedestal(gallery, x, z, materials);
  }
  gallery.add(buildGalleryLighting(count));
  return gallery;
}
