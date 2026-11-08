import { describe, expect, it } from "vitest";
import { advanceUvOffset, FLOW_SPEED_A, FLOW_SPEED_B } from "./particleRiver";

describe("galaxy river texture flow", () => {
  it("advances two UV layers at different speeds without resetting on a window change", () => {
    const dt = 0.05;
    const first = advanceUvOffset(0, dt, FLOW_SPEED_A);
    const second = advanceUvOffset(first, dt, FLOW_SPEED_A);
    const other = advanceUvOffset(0, dt, FLOW_SPEED_B);
    expect(first).toBeCloseTo(dt * FLOW_SPEED_A);
    expect(second).toBeGreaterThan(first);
    expect(other).toBeCloseTo(dt * FLOW_SPEED_B);
    expect(other).not.toBe(first);
    expect(advanceUvOffset(0.9995, 0.05, FLOW_SPEED_A)).toBeLessThan(0.1);
    expect(advanceUvOffset(first, 0, FLOW_SPEED_A)).toBe(first);
    expect(advanceUvOffset(0, 1, FLOW_SPEED_A)).toBeCloseTo(0.05 * FLOW_SPEED_A);
  });
});
