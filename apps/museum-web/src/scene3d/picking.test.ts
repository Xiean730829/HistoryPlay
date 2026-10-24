import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Raycaster, Vector3 } from "three";
import { pickArtifact } from "./picking";

function volume(id: string, z: number) {
  const mesh = new Mesh(new BoxGeometry(2, 3, 1), new MeshBasicMaterial({ visible: false }));
  mesh.position.z = z; mesh.userData.artifactId = id; return mesh;
}

describe("museum case picking", () => {
  it("selects the nearest case even through glass and an empty coin center", () => {
    const front = volume("coin", -2); const rear = volume("bull", -7);
    const glass = new Mesh(new BoxGeometry(2, 3, 0.02), new MeshBasicMaterial({ transparent: true, opacity: 0.08 }));
    glass.position.z = -1;
    const scene = new Group(); scene.add(front, rear, glass); scene.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    expect(pickArtifact(ray, scene.children)).toBe("coin");
  });
  it("does not pick the object behind an opaque column", () => {
    const column = new Mesh(new BoxGeometry(1, 4, 1), new MeshBasicMaterial());
    const exhibit = volume("bull", -3);
    const scene = new Group(); scene.add(exhibit, column); scene.updateMatrixWorld(true);
    expect(pickArtifact(new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)), scene.children)).toBeNull();
  });
  it("passes through physically transmissive display glass even when transparent=false", () => {
    const glass = new Mesh(new BoxGeometry(2, 3, 0.02), new MeshPhysicalMaterial({ transmission: 0.95, transparent: false }));
    const scene = new Group(); scene.add(glass, volume("stele", -2)); scene.updateMatrixWorld(true);
    expect(pickArtifact(new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)), scene.children)).toBe("stele");
  });
});
