import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pendingGithubUpdate, confirmGithubUpdate, recoverInterruptedUpdate, pruneGithubUpdateBackups } from "./github-update.mjs";

const VERSION = "b".repeat(40);
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-update-confirm-"));
  const state = path.join(root, ".runtime", "github-updater");
  const backup = path.join(state, "backups", "00000000-0000-4000-8000-00000000ff00");
  try {
    await mkdir(backup, { recursive: true });
    await run({ root, state, backup });
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function journal(state, record) {
  await writeFile(path.join(state, "pending.json"), JSON.stringify(record) + "\n");
}
test("successful startup confirmation removes only the pending transaction marker", async () => fixture(async ({ root, state, backup }) => {
  await writeFile(path.join(backup, ".akariya-version"), "a".repeat(40) + "\n");
  await journal(state, { sha: VERSION, backup, names: [], existed: {} });
  assert.equal(await pendingGithubUpdate(root), VERSION);
  await assert.rejects(confirmGithubUpdate("a".repeat(40), root), /SHA mismatch/);
  await confirmGithubUpdate(VERSION, root);
  assert.equal(await pendingGithubUpdate(root), null);
  assert.equal(await readFile(path.join(backup, ".akariya-version"), "utf8"), "a".repeat(40) + "\n");
}));
test("interrupted replacement restores code and version without touching user data", async () => fixture(async ({ root, state, backup }) => {
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(backup, "scripts"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "scripts", "launch.mjs"), "new");
  await writeFile(path.join(backup, "scripts", "launch.mjs"), "old");
  await writeFile(path.join(root, "data", "private.json"), '{"keep":true}');
  await writeFile(path.join(root, ".akariya-version"), VERSION + "\n");
  await writeFile(path.join(backup, ".akariya-version"), "a".repeat(40) + "\n");
  await journal(state, { sha: VERSION, backup, names: ["scripts"], existed: { scripts: true } });
  assert.equal(await recoverInterruptedUpdate(root), true);
  assert.equal(await readFile(path.join(root, "scripts", "launch.mjs"), "utf8"), "old");
  assert.equal(await readFile(path.join(root, ".akariya-version"), "utf8"), "a".repeat(40) + "\n");
  assert.equal(await readFile(path.join(root, "data", "private.json"), "utf8"), '{"keep":true}');
  await assert.rejects(stat(path.join(state, "pending.json")), /ENOENT/);
}));
test("unrecognized journal paths are refused without changing installed application", async () => fixture(async ({ root, state, backup }) => {
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "private.json"), "safe");
  await journal(state, { sha: VERSION, backup, names: ["data"], existed: { data: true } });
  await assert.rejects(recoverInterruptedUpdate(root), /metadata invalid/);
  assert.equal(await readFile(path.join(root, "data", "private.json"), "utf8"), "safe");
}));

test("retains three latest recognized backups and keeps unknown folders", async () => fixture(async ({ root, state }) => {
  const directory = path.join(state, "backups");
  for (let i = 0; i < 5; i++) {
    const name = "00000000-0000-4000-8000-00000000000" + i;
    const folder = path.join(directory, name);
    await mkdir(folder);
    await writeFile(path.join(folder, ".akariya-backup.json"),
      JSON.stringify({ kind: "akariya-github-backup", schemaVersion: 1 }) + "\n");
    const timestamp = new Date(Date.UTC(2026, 0, i + 1));
    await utimes(folder, timestamp, timestamp);
  }
  const unknown = path.join(directory, "00000000-0000-4000-8000-000000000099");
  await mkdir(unknown);
  await writeFile(path.join(unknown, "user.txt"), "preserve");
  const removed = await pruneGithubUpdateBackups(root);
  assert.equal(removed.length, 2);
  assert.equal((await readdir(directory)).length, 5); // 3 recognized and 2 unknown backups
  assert.equal(await readFile(path.join(unknown, "user.txt"), "utf8"), "preserve");
}));

test("forged backup path fails closed without modifying user data", async () => fixture(async ({ root, state, backup }) => {
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "private.json"), "safe");
  await journal(state, { sha: VERSION, backup: path.join(state, "backups", "..", "..", "data"),
    names: ["scripts"], existed: { scripts: true } });
  await assert.rejects(recoverInterruptedUpdate(root), /metadata invalid/);
  assert.equal(await readFile(path.join(root, "data", "private.json"), "utf8"), "safe");
}));
