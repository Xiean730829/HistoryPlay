import { describe, expect, it } from "vitest";
import { isMuseumEntryConsent } from "./entryConsent";

describe("museum entrance consent", () => {
  it.each(["可以", "好啊！", "带我进去吧", "开始参观。", "嗯，可以带我进去"])("accepts %s", (text) => {
    expect(isMuseumEntryConsent(text)).toBe(true);
  });

  it.each(["不可以", "先等等", "嗯", "可以不可以", "不要进去"])("keeps the entrance closed for %s", (text) => {
    expect(isMuseumEntryConsent(text)).toBe(false);
  });
});
