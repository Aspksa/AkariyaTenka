import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyPreparedUpdate,
  applyRollbackRequest,
  atomicWriteFile,
  confirmUpdate,
  pruneUpdateFolder,
  rollbackFailedStart,
  rollbackInstall,
  safeUpdatePath,
} from "./apply-update.mjs";

const hash = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const UPDATE_A = "a".repeat(40);
const UPDATE_B = "b".repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-updater-"));
  await mkdir(path.join(root, ".updates", "staging"), { recursive: true });
  return root;
}

async function stage(root, files, { sha = UPDATE_A, removals } = {}) {
  const manifest = {
    sha,
    files: files.map(([name, contents]) => ({ path: name, sha: hash(Buffer.from(contents)) })),
    ...(removals ? { removals } : {}),
  };
  await writeFile(path.join(root, ".updates", "ready.json"), JSON.stringify(manifest));
  for (const [name, contents] of files) {
    const destination = path.join(root, ".updates", "staging", name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return manifest;
}

async function jsonl(file) {
  const raw = await readFile(file, "utf8");
  return raw.trim().split("\n").filter(Boolean).map(JSON.parse);
}

async function history(root) {
  return jsonl(path.join(root, ".updates", "history.jsonl"));
}

test("safe update paths reject traversal, protected data and Windows reserved names", () => {
  const bad = [
    "../secret", ".", ".env", ".env.local", ".env.production", ".env/key", "data/user.json", ".updates/ready.json", ".runtime/node.exe",
    "node_modules/pkg/a.js", ".akariya-version", "C:/secret", "\\\\server\\share", "folder/CON.txt",
    "folder/PRN", "folder/COM9.log", "folder/LPT1", "folder/..", "folder/trailing.", "folder/trailing ",
    "folder/name:stream", "folder/que?stion",
  ];
  for (const candidate of bad) assert.equal(safeUpdatePath(candidate), false, candidate);
  assert.equal(safeUpdatePath("apps/web/src/main.ts"), true);
});

test("duplicate manifest paths are rejected before installation", async () => {
  const root = await fixture();
  try {
    await stage(root, [["apps/a.txt", "one"]]);
    const readyFile = path.join(root, ".updates", "ready.json");
    const manifest = JSON.parse(await readFile(readyFile, "utf8"));
    manifest.files.push({ path: "APPS/A.TXT", sha: manifest.files[0].sha });
    await writeFile(readyFile, JSON.stringify(manifest));
    await assert.rejects(applyPreparedUpdate(root), /Duplicate update path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt staged hash aborts before the first installed file changes", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "one.txt"), "old");
    await stage(root, [["apps/one.txt", "new"], ["apps/two.txt", "good"]]);
    await writeFile(path.join(root, ".updates", "staging", "apps", "two.txt"), "tampered");
    await assert.rejects(applyPreparedUpdate(root), /hash mismatch/);
    assert.equal(await readFile(path.join(root, "apps", "one.txt"), "utf8"), "old");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("protected .env and data remain untouched", async () => {
  for (const target of [".env", "data/profile.json"]) {
    const root = await fixture();
    try {
      const destination = path.join(root, target);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, "private");
      await stage(root, [[target, "attacker"]]);
      await assert.rejects(applyPreparedUpdate(root), /manifest|unsafe/i);
      assert.equal(await readFile(destination, "utf8"), "private");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("symlink or junction destination cannot escape the project root", async () => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "akariya-outside-"));
  try {
    const link = path.join(root, "linked");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await stage(root, [["linked/payload.txt", "payload"]]);
    await assert.rejects(applyPreparedUpdate(root), /indirection|unsafe|escapes/i);
    await assert.rejects(readFile(path.join(outside, "payload.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("atomicWriteFile replaces content without leaving temporary update files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-atomic-"));
  try {
    const file = path.join(root, "file.txt");
    await writeFile(file, "old");
    await atomicWriteFile(file, Buffer.from("new"));
    assert.equal(await readFile(file, "utf8"), "new");
    assert.deepEqual((await readdir(root)).filter((name) => name.includes(".akariya-update-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed post-install check rolls back changed files and version marker", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "a.txt"), "old");
    await writeFile(path.join(root, ".akariya-version"), "old-version\n");
    await stage(root, [["apps/a.txt", "new"], ["apps/new.txt", "created"]]);
    await assert.rejects(applyPreparedUpdate(root, { healthCheck: async () => { throw new Error("broken build"); } }), /broken build/);
    assert.equal(await readFile(path.join(root, "apps", "a.txt"), "utf8"), "old");
    await assert.rejects(readFile(path.join(root, "apps", "new.txt")));
    assert.equal(await readFile(path.join(root, ".akariya-version"), "utf8"), "old-version\n");
    const rows = await history(root);
    assert.equal(rows.at(-1)?.kind, "failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("removals require confirmation bound to the exact update SHA", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "old.txt"), "old");
    await stage(root, [["apps/new.txt", "new"]], { sha: UPDATE_A, removals: ["apps/old.txt"] });
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root, "apps", "old.txt"), "utf8"), "old");
    await confirmUpdate(root);

    await mkdir(path.join(root, ".updates", "staging"), { recursive: true });
    await stage(root, [["apps/newer.txt", "newer"]], { sha: UPDATE_B, removals: ["apps/old.txt"] });
    await writeFile(path.join(root, ".updates", "removals-confirmed.json"), JSON.stringify({ sha: UPDATE_A, paths: ["apps/old.txt"] }));
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root, "apps", "old.txt"), "utf8"), "old");
    await confirmUpdate(root);

    await mkdir(path.join(root, ".updates", "staging"), { recursive: true });
    const sha = "c".repeat(40);
    await stage(root, [["apps/final.txt", "final"]], { sha, removals: ["apps/old.txt"] });
    await writeFile(path.join(root, ".updates", "removals-confirmed.json"), JSON.stringify({ sha, paths: ["apps/old.txt"] }));
    await applyPreparedUpdate(root);
    await assert.rejects(readFile(path.join(root, "apps", "old.txt")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("confirmed removal is restored when installation fails", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "old.txt"), "keep");
    await stage(root, [["apps/new.txt", "new"]], { removals: ["apps/old.txt"] });
    await writeFile(path.join(root, ".updates", "removals-confirmed.json"), JSON.stringify({ sha: UPDATE_A, paths: ["apps/old.txt"] }));
    await assert.rejects(applyPreparedUpdate(root, { healthCheck: async () => { throw new Error("fail"); } }));
    assert.equal(await readFile(path.join(root, "apps", "old.txt"), "utf8"), "keep");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed startup automatically restores the previous installation", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "a.txt"), "old");
    await writeFile(path.join(root, ".akariya-version"), "old-version\n");
    await writeFile(path.join(root, ".updates", "installed.json"), JSON.stringify({ sha: "old", paths: ["apps/a.txt"] }));
    await stage(root, [["apps/a.txt", "new"], ["apps/added.txt", "added"]]);
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root, "apps", "a.txt"), "utf8"), "new");
    assert.equal(await rollbackFailedStart(root, "server did not become healthy"), true);
    assert.equal(await readFile(path.join(root, "apps", "a.txt"), "utf8"), "old");
    await assert.rejects(readFile(path.join(root, "apps", "added.txt")));
    assert.equal(await readFile(path.join(root, ".akariya-version"), "utf8"), "old-version\n");
    assert.equal(JSON.parse(await readFile(path.join(root, ".updates", "installed.json"), "utf8")).sha, "old");
    assert.equal((await history(root)).at(-1)?.kind, "startup_failed");
    assert.equal(await rollbackFailedStart(root, "again"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manual rollback request restores a valid backup", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, "apps"), { recursive: true });
    await writeFile(path.join(root, "apps", "a.txt"), "old");
    await stage(root, [["apps/a.txt", "new"]]);
    await applyPreparedUpdate(root);
    await confirmUpdate(root);
    const install = (await history(root)).find((item) => item.kind === "install");
    await writeFile(path.join(root, ".updates", "rollback-request.json"), JSON.stringify({ backup: install.backup }));
    assert.equal(await applyRollbackRequest(root), true);
    assert.equal(await readFile(path.join(root, "apps", "a.txt"), "utf8"), "old");
    assert.equal((await history(root)).at(-1)?.kind, "rollback");
    await assert.rejects(readFile(path.join(root, ".updates", "rollback-request.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rollback rejects damaged backup metadata and unsafe backup names", async () => {
  const root = await fixture();
  try {
    for (const bad of ["../x", "a/b", "", "123-x", "x y"]) await assert.rejects(rollbackInstall(root, bad), /Invalid backup name/);
    const backupName = "1730000000000-deadbeef";
    const backup = path.join(root, ".updates", "backups", backupName);
    await mkdir(backup, { recursive: true });
    await writeFile(path.join(backup, ".meta.json"), JSON.stringify({ updateSha: UPDATE_A, changes: [{ path: ".env", existed: false }] }));
    await assert.rejects(rollbackInstall(root, backupName), /metadata is damaged/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("backup pruning keeps only the newest controlled backup directories", async () => {
  const root = await fixture();
  try {
    const backups = path.join(root, ".updates", "backups");
    for (const name of [
      "1730000000001-11111111", "1730000000002-22222222", "1730000000003-33333333",
      "1730000000004-44444444", "1730000000005-55555555", "not-controlled",
    ]) await mkdir(path.join(backups, name), { recursive: true });
    for (const id of [1, 2, 3, 4, 5]) await writeFile(path.join(root, ".updates", `ready.failed-${id}.json`), "{}");
    await pruneUpdateFolder(path.join(root, ".updates"), 3);
    assert.deepEqual((await readdir(backups)).sort(), [
      "1730000000003-33333333", "1730000000004-44444444", "1730000000005-55555555", "not-controlled",
    ]);
    assert.deepEqual((await readdir(path.join(root, ".updates"))).filter((name) => name.startsWith("ready.failed-")).sort(), [
      "ready.failed-3.json", "ready.failed-4.json", "ready.failed-5.json",
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("successful update waits for startup confirmation", async () => {
  const root = await fixture();
  try {
    await stage(root, [["apps/a.txt", "ok"]]);
    assert.equal(await applyPreparedUpdate(root), true);
    const pending = JSON.parse(await readFile(path.join(root, ".updates", "pending-confirm.json"), "utf8"));
    assert.equal(pending.sha, UPDATE_A);
    assert.equal(await readFile(path.join(root, ".akariya-version"), "utf8"), `${UPDATE_A}\n`);
    assert.equal(await confirmUpdate(root), true);
    await assert.rejects(readFile(path.join(root, ".updates", "pending-confirm.json")));
    assert.equal(await confirmUpdate(root), false);
    const events = await jsonl(path.join(root, ".updates", "events.jsonl"));
    assert.ok(events.some((event) => event.type === "update_confirmed"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
