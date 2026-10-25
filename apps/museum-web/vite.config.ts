import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "MUSEUM_");
  const webPort = Number(env.MUSEUM_WEB_PORT ?? 5173);
  const allowedOrigins = new Set((env.MUSEUM_WEB_ORIGINS ?? env.MUSEUM_WEB_ORIGIN
    ?? `http://127.0.0.1:${webPort}`).split(",").map((origin) => origin.trim()).filter(Boolean));
  const forwardAllowedOrigin = (proxyRequest: { setHeader(name: string, value: string): void },
    request: { headers: { origin?: string; host?: string } }) => {
    const origin = request.headers.origin ?? (request.headers.host ? `http://${request.headers.host}` : "");
    if (allowedOrigins.has(origin)) proxyRequest.setHeader("Origin", origin);
  };
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: Number(env.MUSEUM_WEB_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${env.MUSEUM_PORT ?? 8780}`,
          rewrite: (path) => (path === "/api/health" ? "/health" : path),
        },
        "/voice": {
          target: `http://127.0.0.1:${env.MUSEUM_VOICE_PORT ?? 8782}`,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on("proxyReq", forwardAllowedOrigin);
            proxy.on("proxyReqWs", forwardAllowedOrigin);
          },
        },
      },
    },
  };
});
