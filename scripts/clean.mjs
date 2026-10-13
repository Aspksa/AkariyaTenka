import { rm } from "node:fs/promises";

const targets = [
  "apps/server/dist",
  "apps/web/dist",
  "packages/core/dist",
  "packages/contracts/dist",
  "packages/persistence/dist",
  "packages/security/dist",
  "packages/assistant/dist"
];

await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
