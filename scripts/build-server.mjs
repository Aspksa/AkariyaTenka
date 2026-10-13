import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const source = (name) => path.join(root, "packages", name, "src", "index.ts");

await build({
  configFile: false,
  root,
  logLevel: "info",
  resolve: {
    alias: {
      "@akariya/core": source("core"),
      "@akariya/contracts": source("contracts"),
      "@akariya/persistence": source("persistence"),
      "@akariya/security": source("security"),
      "@akariya/assistant": source("assistant"),
    },
  },
  ssr: {
    noExternal: ["zod"],
  },
  build: {
    target: "node20",
    ssr: path.join(root, "apps", "server", "src", "main.ts"),
    outDir: path.join(root, "apps", "server", "dist"),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "server.mjs",
        chunkFileNames: "chunks/[name]-[hash].mjs",
      },
    },
  },
});
