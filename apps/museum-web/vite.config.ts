import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "MUSEUM_");
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
        },
      },
    },
  };
});
