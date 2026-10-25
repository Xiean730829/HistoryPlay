const DEFAULT_LOCAL_VOICE_BRIDGE = "http://127.0.0.1:8784";

export function resolveLocalVoiceBridgeUrl(
  configuredUrl: string | undefined,
  pageOrigin: string,
): string {
  const candidate = configuredUrl?.trim();
  if (!candidate) return DEFAULT_LOCAL_VOICE_BRIDGE;
  let url: URL;
  let page: URL;
  try {
    url = new URL(candidate);
    page = new URL(pageOrigin);
  } catch {
    throw new Error("本机语音桥地址配置无效");
  }
  if (url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== "") {
    throw new Error("语音桥地址必须是无凭证的本机回环HTTP地址");
  }
  // A same-origin Vite URL is only a proxy route, not the voice service.
  // Avoid relying on WebSocket proxy upgrades and use the fixed local bridge.
  if (url.origin === page.origin) return DEFAULT_LOCAL_VOICE_BRIDGE;
  return url.origin;
}
