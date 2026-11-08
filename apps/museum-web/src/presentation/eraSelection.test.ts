import { describe, expect, it, vi } from "vitest";
import { applyEntranceIntent, selectEraFromEntrance } from "./eraSelection";

describe("museum entrance era selection", () => {
  it("requires a dynasty after a generic agreement or request", () => {
    expect(selectEraFromEntrance("可以")).toEqual({ kind: "clarify" });
    expect(selectEraFromEntrance("好的")).toEqual({ kind: "clarify" });
    expect(selectEraFromEntrance("带我进入博物馆")).toEqual({ kind: "clarify" });
  });
  it("accepts an explicit request for one dynasty", () => {
    expect(selectEraFromEntrance("进入宋代")).toEqual({ kind: "selected", era: "song" });
    expect(selectEraFromEntrance("进入唐代")).toEqual({ kind: "selected", era: "tang" });
    expect(selectEraFromEntrance("带我进入宋代展厅")).toEqual({ kind: "selected", era: "song" });
    expect(selectEraFromEntrance("我要去看唐朝")).toEqual({ kind: "selected", era: "tang" });
  });
  it("does not treat in-hall dynasty filters as an entrance switch", () => {
    expect(selectEraFromEntrance("看宋朝的文物")).toEqual({ kind: "none" });
    expect(selectEraFromEntrance("看宋代1100年前后")).toEqual({ kind: "none" });
  });
  it("does not open either hall on negated or conflicting requests", () => {
    expect(selectEraFromEntrance("不要去宋朝")).toEqual({ kind: "none" });
    expect(selectEraFromEntrance("不去唐朝，去宋朝")).toEqual({ kind: "clarify" });
    expect(selectEraFromEntrance("唐朝还是宋朝")).toEqual({ kind: "clarify" });
  });
  it("routes voice and buttons through the same entrance transaction", () => {
    const select = vi.fn();
    const clarify = vi.fn();
    expect(applyEntranceIntent("进入宋代", select, clarify)).toBe(true);
    expect(select).toHaveBeenCalledWith("song");
    expect(applyEntranceIntent("可以", select, clarify)).toBe(true);
    expect(clarify).toHaveBeenCalledTimes(1);
    expect(applyEntranceIntent("看鎏金牛", select, clarify)).toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
