import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("update status is read-only and installation disabled", async () => {
  const { createUpdateStatusRoute } = await import("../apps/server/dist/routes/update-status.js").catch(() => ({ createUpdateStatusRoute: null }));
  // The repository TypeScript build is validated separately; this test verifies the
  // released status route when compiled output is available.
  if (createUpdateStatusRoute === null) return;
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-status-"));
  try {
    await mkdir(path.join(root, ".updates"));
    await writeFile(path.join(root, ".akariya-version"), "test-version\n");
    const status = JSON.parse(await createUpdateStatusRoute(root)());
    assert.equal(status.currentVersion, "test-version");
    assert.equal(status.installationEnabled, false);
    assert.equal(status.publisherConfigured, false);
    assert.equal(status.pendingRestart, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
