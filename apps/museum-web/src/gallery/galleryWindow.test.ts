import { describe, expect, it } from "vitest";
import { galleryWindowBounds, galleryWindowLabel } from "./galleryWindow";

describe("galleryWindowBounds", () => {
  it("uses the server window and page size for eight stations", () => {
    expect(galleryWindowBounds(8, 0, 4)).toEqual({
      start: 0, end: 4, pageSize: 4, total: 8, hasPrevious: false, hasNext: true,
    });
    expect(galleryWindowBounds(8, 4, 4)).toEqual({
      start: 4, end: 8, pageSize: 4, total: 8, hasPrevious: true, hasNext: false,
    });
  });

  it("keeps a 19-item last page without inventing extra slots", () => {
    expect(galleryWindowBounds(19, 16, 4)).toMatchObject({
      start: 16, end: 19, hasPrevious: true, hasNext: false,
    });
  });

  it("pages eighteen stations in threes without a client-only counter", () => {
    expect(galleryWindowBounds(18, 0, 3)).toEqual({
      start: 0, end: 3, pageSize: 3, total: 18, hasPrevious: false, hasNext: true,
    });
    expect(galleryWindowBounds(18, 15, 3)).toEqual({
      start: 15, end: 18, pageSize: 3, total: 18, hasPrevious: true, hasNext: false,
    });
    expect(galleryWindowBounds(4, 3, 3)).toMatchObject({
      start: 3, end: 4, pageSize: 3, hasPrevious: true, hasNext: false,
    });
  });

  it("labels Song windows as scrolls and Tang windows as exhibits", () => {
    expect(galleryWindowLabel(18, 0, 3)).toBe("第1卷 · 1—3 / 共6卷 · 18件");
    expect(galleryWindowLabel(18, 15, 3)).toBe("第6卷 · 16—18 / 共6卷 · 18件");
    expect(galleryWindowLabel(36, 0, 3)).toBe("第1卷 · 1—3 / 共12卷 · 36件");
    expect(galleryWindowLabel(36, 18, 3)).toBe("第7卷 · 19—21 / 共12卷 · 36件");
    expect(galleryWindowLabel(36, 33, 3)).toBe("第12卷 · 34—36 / 共12卷 · 36件");
    expect(galleryWindowLabel(1, 0, 3)).toBe("第1卷 · 1—1 / 共1卷 · 1件");
    expect(galleryWindowLabel(16, 0, 4)).toBe("1—4 / 共16件");
  });

  it("pages thirty-six stations in threes without mixing windows", () => {
    expect(galleryWindowBounds(36, 0, 3)).toEqual({
      start: 0, end: 3, pageSize: 3, total: 36, hasPrevious: false, hasNext: true,
    });
    expect(galleryWindowBounds(36, 18, 3)).toEqual({
      start: 18, end: 21, pageSize: 3, total: 36, hasPrevious: true, hasNext: true,
    });
    expect(galleryWindowBounds(36, 33, 3)).toEqual({
      start: 33, end: 36, pageSize: 3, total: 36, hasPrevious: true, hasNext: false,
    });
  });
});
