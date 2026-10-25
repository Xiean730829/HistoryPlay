import { describe, expect, it } from "vitest";
import { AppliedCamera } from "./AppliedCamera";

describe("actual camera evidence", () => {
  it("rejects the previous face and distance until the actual camera reaches the goal", () => {
    const camera = new AppliedCamera();
    expect(camera.matches("0deg 90deg 100%", { theta: 0, phi: Math.PI / 2, radius: 4 })).toBe(true);
    expect(camera.matches("-180deg 90deg 100%", { theta: 0, phi: Math.PI / 2, radius: 4 })).toBe(false);
    expect(camera.matches("-180deg 90deg 100%", { theta: Math.PI, phi: Math.PI / 2, radius: 4 })).toBe(true);
    expect(camera.matches("-180deg 90deg 50%", { theta: Math.PI, phi: Math.PI / 2, radius: 4 })).toBe(false);
    expect(camera.matches("-180deg 90deg 50%", { theta: Math.PI, phi: Math.PI / 2, radius: 2 })).toBe(true);
  });
  it("rejects invalid or unmeasurable views", () => {
    const camera = new AppliedCamera();
    expect(camera.matches("auto auto auto", { theta: 0, phi: 0, radius: 4 })).toBe(false);
    expect(camera.matches("0deg 90deg 100%", { theta: 0, phi: Math.PI / 2, radius: NaN })).toBe(false);
  });
});
