import { describe, expect, it } from "vitest";
import { CorridorMotion } from "./CorridorMotion";

describe("CorridorMotion", () => {
  it("lands on the initial target without animating hydration", () => {
    const motion = new CorridorMotion();
    expect(motion.observe(null)).toEqual({ targetId: null, generation: 1, animate: false });
    expect(motion.observe("coin")).toEqual({ targetId: "coin", generation: 2, animate: true });
  });

  it("retargets rapidly, including direction reversals, without promoting frames to focus", () => {
    const motion = new CorridorMotion();
    motion.observe("stele");

    expect(motion.observe("coin")).toEqual({ targetId: "coin", generation: 2, animate: true });
    expect(motion.observe("bull")).toEqual({ targetId: "bull", generation: 3, animate: true });
    expect(motion.observe("coin")).toEqual({ targetId: "coin", generation: 4, animate: true });
    expect(motion.observe("coin")).toEqual({ targetId: "coin", generation: 4, animate: false });
  });
});
