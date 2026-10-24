import { Box3, Group, Vector3 } from "three";

export interface StationPlacement { x: number; z: number; top: number }
export function stationPlacement(index: number): StationPlacement {
  return { x: index % 2 ? 2.15 : -2.15, z: -2 - index * 5.8, top: 1.05 };
}

export function nearbyModelIndices(count: number, focused: number, limit = 3): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused)).slice(0, limit));
}

/** Fit the true mesh above the plinth; the object keeps its original proportions. */
export function seatModel(model: Group, width = 1.65, height = 1.9): Group {
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  if (!Number.isFinite(size.length()) || size.length() === 0) throw new Error("文物几何为空");
  const scale = Math.min(width / Math.max(size.x, size.z), height / size.y);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(model);
  const center = fitted.getCenter(new Vector3());
  model.position.add(new Vector3(-center.x, -fitted.min.y, -center.z));
  const seated = new Group();
  seated.add(model);
  return seated;
}
