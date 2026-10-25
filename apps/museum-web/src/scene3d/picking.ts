import { Mesh, MeshPhysicalMaterial, Object3D, Raycaster } from "three";

/** Clear case panes and display labels do not consume a click. */
export function pickArtifact(raycaster: Raycaster, objects: Object3D[]): string | null {
  for (const hit of raycaster.intersectObjects(objects, true)) {
    let target: Object3D | null = hit.object;
    while (target && !target.userData.artifactId) target = target.parent;
    if (target?.userData.artifactId) return String(target.userData.artifactId);
    if (hit.object.userData.pickThrough) continue;
    if (hit.object instanceof Mesh) {
      const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
      if (materials.every((material) => material.transparent || (material instanceof MeshPhysicalMaterial && material.transmission > 0.2))) continue;
      // A solid exhibit surface stays ahead of anything behind it.
      return null;
    }
  }
  return null;
}
