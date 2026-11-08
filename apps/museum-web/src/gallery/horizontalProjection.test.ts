import { describe, expect, it } from "vitest";
import {
  DESKTOP_PAGE_SIZE,
  filterStationsByTime,
  pageSizeForViewport,
  projectHorizontal,
  windowStartForIndex,
} from "./horizontalProjection";

function stations(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));
}

describe("horizontal four-slot projection", () => {
  it("keeps an empty gallery empty", () => {
    expect(projectHorizontal([], null, 1366)).toEqual([]);
  });

  it.each([1, 3, 4])("shows %s exhibits in one window without padding copies", (count) => {
    const projection = projectHorizontal(stations(count), "item-0", 1366);
    expect(projection.filter((item) => item.isVisible)).toHaveLength(count);
    expect(new Set(projection.map((item) => item.id)).size).toBe(count);
    expect(projection.every((item) => item.scale === 1)).toBe(true);
  });

  it("puts four desktop slots in one window at equal scale", () => {
    const projection = projectHorizontal(stations(8), "item-1", 1366);
    const visible = projection.filter((item) => item.isVisible);
    expect(visible.map((item) => item.id)).toEqual(["item-0", "item-1", "item-2", "item-3"]);
    expect(visible.map((item) => item.xPercent)).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(visible.every((item) => item.scale === 1)).toBe(true);
    expect(projection[1]?.isFocused).toBe(true);
  });

  it("opens the second window for the fifth exhibit and does not pad the last page", () => {
    const five = projectHorizontal(stations(5), "item-4", 1440);
    expect(five.filter((item) => item.isVisible).map((item) => item.id)).toEqual(["item-4"]);
    const eight = projectHorizontal(stations(8), "item-7", 1920);
    expect(eight.filter((item) => item.isVisible).map((item) => item.id))
      .toEqual(["item-4", "item-5", "item-6", "item-7"]);
  });

  it("keeps 19 exhibits in unique server order across five windows", () => {
    const projection = projectHorizontal(stations(19), "item-18", 1366);
    expect(projection.map((item) => item.displayIndex)).toEqual([...Array(19).keys()]);
    expect(projection.filter((item) => item.isVisible).map((item) => item.id))
      .toEqual(["item-16", "item-17", "item-18"]);
    expect(windowStartForIndex(18, 19, DESKTOP_PAGE_SIZE)).toBe(16);
  });

  it("uses an explicit window even when the focused item is elsewhere", () => {
    const projection = projectHorizontal(stations(8), "item-7", 1366, 0);
    expect(projection.filter((item) => item.isVisible).map((item) => item.id))
      .toEqual(["item-0", "item-1", "item-2", "item-3"]);
    expect(projection.find((item) => item.id === "item-7")?.isFocused).toBe(true);
    expect(projection.find((item) => item.id === "item-7")?.isVisible).toBe(false);
  });

  it("narrows to two slots under 1024px and one slot on phones", () => {
    expect(pageSizeForViewport(1024)).toBe(4);
    expect(pageSizeForViewport(900)).toBe(2);
    expect(pageSizeForViewport(390)).toBe(1);
    const tablet = projectHorizontal(stations(8), "item-3", 900);
    expect(tablet.filter((item) => item.isVisible).map((item) => item.id)).toEqual(["item-2", "item-3"]);
    const phone = projectHorizontal(stations(8), "item-5", 390);
    expect(phone.filter((item) => item.isVisible).map((item) => item.id)).toEqual(["item-5"]);
  });

  it("rejects duplicate IDs, missing focus and invalid widths", () => {
    expect(() => projectHorizontal([{ id: "a" }, { id: "a" }], "a", 1366)).toThrow(/标识重复/);
    expect(() => projectHorizontal(stations(2), "missing", 1366)).toThrow(/不在服务端可见顺序中/);
    expect(() => projectHorizontal(stations(2), "item-0", 0)).toThrow(/视口宽度必须是正数/);
  });

  it("projects a server-filtered subset without inventing order or padding copies", () => {
    const filtered = projectHorizontal(
      [{ id: "item-1" }, { id: "item-4" }, { id: "item-7" }],
      "item-4",
      1366,
    );
    expect(filtered.map((item) => item.id)).toEqual(["item-1", "item-4", "item-7"]);
    expect(filtered.filter((item) => item.isVisible).map((item) => item.id))
      .toEqual(["item-1", "item-4", "item-7"]);
    expect(filtered.every((item) => item.scale === 1)).toBe(true);
  });

  it("intersects closed year ranges without reordering the server sequence", () => {
    const stations = [
      { id: "a", time_range: { start_year: 618, end_year: 650 } },
      { id: "b", time_range: { start_year: 713, end_year: 741 } },
      { id: "c", time_range: { start_year: 800, end_year: 850 } },
    ];
    expect(filterStationsByTime(stations, { start_year: 750, end_year: 750 }).map((item) => item.id))
      .toEqual([]);
    expect(filterStationsByTime(stations, { start_year: 701, end_year: 800 }).map((item) => item.id))
      .toEqual(["b", "c"]);
  });
});
