export function resolveLocalVoiceBridgeUrl(
  configuredUrl: string | undefined,
  pageOrigin: string,
): string {
  const candidate = configuredUrl?.trim() || pageOrigin;
  let url: URL;
  try {
    url = new URL(candidate);
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
  return url.origin;
}
