import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertPortableLaunchAllowed } from "./portable-launch-guard.mjs";
import { withPortableSyncLocks } from "./portable-sync-lock.mjs";

test("launcher preflight rejects active sync lock and allows launch after release", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-launch-guard-"));
  try {
    await assertPortableLaunchAllowed(root);
    await withPortableSyncLocks([root], async () => {
      await assert.rejects(assertPortableLaunchAllowed(root), /synchronization lock present/);
    });
    await assertPortableLaunchAllowed(root);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher preflight fails closed on unsafe state path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-launch-guard-unsafe-"));
  try {
    await writeFile(path.join(root, ".portable-state"), "not a directory");
    await assert.rejects(assertPortableLaunchAllowed(root), /Unsafe portable state/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher refuses leftover lock until explicitly resolved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-launch-guard-stale-"));
  try {
    await mkdir(path.join(root, ".portable-state", "sync.lock"), { recursive: true });
    await assert.rejects(assertPortableLaunchAllowed(root), /synchronization lock present/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
