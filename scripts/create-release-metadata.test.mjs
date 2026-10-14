import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createReleaseMetadata } from "./create-release-metadata.mjs";

test("release metadata binds actual archive bytes and source commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-release-meta-"));
  try {
    const archivePath = path.join(root, "AkariyaTenka.zip");
    const content = Buffer.from("release fixture");
    await writeFile(archivePath, content);
    const sha = "c".repeat(40);
    const meta = await createReleaseMetadata({ archivePath, tag: "v1.2.3", sourceSha: sha });
    assert.equal(meta.archiveSha256, createHash("sha256").update(content).digest("hex"));
    assert.equal(meta.archiveSize, content.length);
    assert.equal(meta.sourceSha, sha);
    await assert.rejects(createReleaseMetadata({ archivePath, tag: "invalid", sourceSha: sha }), /Invalid signed release metadata/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
