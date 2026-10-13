import { env } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@akariya/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url))
    }
  },
  build: {
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: { polyfill: false }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": env.VITE_API_TARGET ?? "http://127.0.0.1:4173" }
  }
});
