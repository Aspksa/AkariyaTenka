import { rm } from "node:fs/promises";

const targets = [
  "apps/server/dist",
  "apps/server/tsconfig.tsbuildinfo",
  "apps/web/dist",
  "packages/core/dist",
  "packages/core/tsconfig.tsbuildinfo",
  "packages/contracts/dist",
  "packages/contracts/tsconfig.tsbuildinfo",
  "packages/persistence/dist",
  "packages/persistence/tsconfig.tsbuildinfo",
  "packages/security/dist",
  "packages/security/tsconfig.tsbuildinfo",
  "packages/assistant/dist",
  "packages/assistant/tsconfig.tsbuildinfo"
];

await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
