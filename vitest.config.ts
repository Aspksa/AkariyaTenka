import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const source = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@akariya/core": source("./packages/core/src/index.ts"),
      "@akariya/contracts": source("./packages/contracts/src/index.ts"),
      "@akariya/persistence": source("./packages/persistence/src/index.ts"),
      "@akariya/security": source("./packages/security/src/index.ts"),
      "@akariya/assistant": source("./packages/assistant/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["{packages,apps}/**/*.test.ts"],
    testTimeout: 10000
  }
});
