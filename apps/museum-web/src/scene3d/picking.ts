import { Mesh, Object3D, Raycaster } from "three";

/** Glass and labels do not consume a click; opaque architecture still occludes a case. */
export function pickArtifact(raycaster: Raycaster, objects: Object3D[]): string | null {
  for (const hit of raycaster.intersectObjects(objects, true)) {
    let target: Object3D | null = hit.object;
    while (target && !target.userData.artifactId) target = target.parent;
    if (target?.userData.artifactId) return String(target.userData.artifactId);
    if (hit.object.userData.pickThrough) continue;
    if (hit.object instanceof Mesh) {
      const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
      if (materials.every((material) => material.transparent)) continue;
      // The nearest solid wall/column prevents selecting another case behind it.
      return null;
    }
  }
  return null;
}
