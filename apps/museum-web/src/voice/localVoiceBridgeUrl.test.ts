import { describe, expect, it } from "vitest";
import { resolveLocalVoiceBridgeUrl } from "./localVoiceBridgeUrl";

describe("本机语音桥地址", () => {
  it("优先使用配置的回环地址", () => {
    expect(resolveLocalVoiceBridgeUrl(
      " http://127.0.0.1:8782 ",
      "http://127.0.0.1:5190",
    )).toBe("http://127.0.0.1:8782");
  });

  it("未配置时回退到当前本机页面来源", () => {
    expect(resolveLocalVoiceBridgeUrl(undefined, "http://127.0.0.1:5190"))
      .toBe("http://127.0.0.1:5190");
  });

  it.each([
    "https://127.0.0.1:8782",
    "http://localhost:8782",
    "http://127.0.0.1:8782/other",
    "http://name:secret@127.0.0.1:8782",
    "http://127.0.0.1:8782?token=private",
    "http://192.168.1.10:8782",
    "https://example.invalid",
  ])("在发请求前拒绝非本机或带附加数据的地址 %s", (url) => {
    expect(() => resolveLocalVoiceBridgeUrl(url, "http://127.0.0.1:5190"))
      .toThrow("语音桥地址必须是无凭证的本机回环HTTP地址");
  });
});
