import { Texture } from "three";

/** Loads the authored exhibit preview with cancellation tied to its asset lease. */
export function loadPreviewTexture(
  url: string,
  signal: AbortSignal,
  createImage: () => HTMLImageElement = () => new Image(),
): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const image = createImage();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("展品预览载入已取消", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      const texture = new Texture(image);
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => { cleanup(); reject(new Error("馆藏预览图片解码失败")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = url;
  });
}
