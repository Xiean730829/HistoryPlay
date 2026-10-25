import { describe, expect, it } from "vitest";
import { loadPreviewTexture } from "./previewTexture";

function fakeImage() {
  const image = {
    src: "",
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
  } as unknown as HTMLImageElement;
  return image;
}

describe("展品预览纹理加载", () => {
  it("解码完成后生成可渲染纹理", async () => {
    const image = fakeImage();
    const controller = new AbortController();
    const loading = loadPreviewTexture("blob:test-preview", controller.signal, () => image);
    image.onload?.(new Event("load"));
    const texture = await loading;
    expect(texture.version).toBeGreaterThan(0);
    expect(image.src).toBe("blob:test-preview");
    texture.dispose();
  });

  it("换展品或退出时中止图片解码并忽略迟到回调", async () => {
    const image = fakeImage();
    const controller = new AbortController();
    const loading = loadPreviewTexture("blob:old-preview", controller.signal, () => image);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(image.src).toBe("");
    expect(image.onload).toBeNull();
  });

  it("已中止的请求不会创建或读取预览图", async () => {
    const image = fakeImage();
    const controller = new AbortController();
    controller.abort();
    const loading = loadPreviewTexture("blob:expired-preview", controller.signal, () => image);
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(image.src).toBe("");
  });
});
