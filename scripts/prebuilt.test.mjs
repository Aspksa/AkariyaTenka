import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeBuildManifest } from "./build-manifest.mjs";
import { verifyPrebuilt } from "./prebuilt.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-prebuilt-"));
  await mkdir(path.join(root, "apps", "server", "dist"), { recursive: true });
  await mkdir(path.join(root, "apps", "web", "dist"), { recursive: true });
  await writeFile(path.join(root, "apps", "server", "dist", "server.mjs"), "export const ok = true;\n");
  await writeFile(path.join(root, "apps", "web", "dist", "index.html"), "<!doctype html><title>Akariya</title>");
  await writeBuildManifest(root, "a".repeat(40));
  return root;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
const prebuiltTest = nodeMajor >= 22 ? test : test.skip;

prebuiltTest("verifies a complete prebuilt release", async () => {
  const root = await fixture();
  try {
    const manifest = await verifyPrebuilt(root);
    assert.equal(manifest?.sourceSha, "a".repeat(40));
    assert.equal(manifest?.nodeMajorMin, 22);
    assert.equal(manifest?.artifacts.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

prebuiltTest("rejects a modified production artifact", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "apps", "server", "dist", "server.mjs"), "tampered\n");
    await assert.rejects(verifyPrebuilt(root), /metadata mismatch|hash mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source trees without a manifest stay on the source path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-source-"));
  try {
    assert.equal(await verifyPrebuilt(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
