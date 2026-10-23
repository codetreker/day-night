import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxy = { target: "http://127.0.0.1:8787", changeOrigin: false };
const callbackURL = process.env.DAYNIGHT_UNIAUTH_CALLBACK_URL;
const callbackPath = callbackURL === undefined ? undefined : new URL(callbackURL).pathname;

export default defineConfig({
  plugins: [react()],
  cacheDir: ".tmp/vite",
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": apiProxy,
      ...(callbackPath === undefined ? {} : { [`^${callbackPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?|$)`]: apiProxy }),
    },
  },
  preview: { host: "127.0.0.1" },
  build: { outDir: "dist", emptyOutDir: true },
});
