import { describe, expect, it } from "vitest";
import { cameraOrbit } from "./cameraOrbit";

describe("cameraOrbit", () => {
  it("maps protocol yaw, pitch and zoom to model-viewer orbit units", () => {
    expect(cameraOrbit({ yaw: 32, pitch: -8, zoom: 2 }, "three-quarter"))
      .toBe("67deg 98deg 50%");
  });

  it("normalizes angles and bounds extreme or invalid zoom values", () => {
    expect(cameraOrbit({ yaw: 360, pitch: 90, zoom: 0 })).toBe("0deg 10deg 400%");
    expect(cameraOrbit({ yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY, zoom: 99 }))
      .toBe("0deg 90deg 12.5%");
  });
});
