import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, appendFile, rm, rename, lstat, readdir, copyFile, statfs } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { acquireRuntimeLock } from "./runtime-lock.mjs";

const SHA = /^[0-9a-f]{40}$/;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".runtime", "github-updater");
const allowed = ["apps", "packages", "scripts", "docs", "AKARIYA.bat", "package.json",
  "package-lock.json", "tsconfig.json", "tsconfig.base.json", "tsconfig.tests.json",
  "vitest.config.ts", "README.md", "SECURITY.md", "CONTRIBUTING.md",
  ".editorconfig", ".gitattributes", ".env.example"];
const protectedNames = new Set(["data", ".env", ".git", "node_modules", ".runtime",
  "keys", ".keys", ".updates", ".portable-state", ".akariya-version"]);
const exists = async p => { try { await lstat(p); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
const HISTORY_EVENTS = new Set(["download_started", "validated", "prepared", "confirmed", "rolled_back", "failed"]);
export async function appendGithubUpdateEvent(event, revision, installRoot = root) {
  if (!HISTORY_EVENTS.has(event) || (revision !== null && (!SHA.test(revision) || typeof revision !== "string")))
    throw Error("Invalid update history record");
  const directory = path.join(installRoot, ".runtime", "github-updater");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "history.jsonl");
  const archived = file + ".1";
  if (await exists(file)) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw Error("Unsafe update history file");
    if (info.size >= 1024 * 1024) {
      await rm(archived, { force: true });
      await rename(file, archived);
    }
  }
  await appendFile(file, JSON.stringify({ at: new Date().toISOString(), event, revision }) + "\n", { mode: 0o600 });
}
async function tryHistory(event, revision, installRoot = root) {
  try { await appendGithubUpdateEvent(event, revision, installRoot); }
  catch (error) { console.warn("Could not write update history:", error); }
}
async function assertOrdinaryDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe update directory: " + directory);
}
async function verifyUpdateFilesystem(installRoot = root) {
  const runtime = path.join(installRoot, ".runtime");
  const updater = path.join(runtime, "github-updater");
  await assertOrdinaryDirectory(installRoot);
  await assertOrdinaryDirectory(runtime);
  await assertOrdinaryDirectory(updater);
  const backups = path.join(updater, "backups");
  if (await exists(backups)) await assertOrdinaryDirectory(backups);
}
async function verifyDestination(installRoot, name) {
  const target = path.join(installRoot, name);
  if (!await exists(target)) return;
  const info = await lstat(target);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw Error("Unsafe installation destination: " + name);
  if (info.isDirectory()) await visit(target, name);
}


async function visit(dir, relative = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw Error("Unsafe staged file: " + entry.name);
    if (entry.name.includes(":") || /[. ]$/.test(entry.name)) throw Error("Unsafe Windows file name");
    if (relative === "" && protectedNames.has(entry.name.toLowerCase())) throw Error("Protected path in update archive");
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(p, path.join(relative, entry.name));
  }
}
async function run(command, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: false, shell: false });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(Error(command + " failed: " + code)));
  });
}
const MIN_FREE_BYTES = 768 * 1024 * 1024;
export async function assertUpdateDiskSpace(installRoot = root) {
  const disk = await statfs(installRoot);
  const available = disk.bavail * disk.bsize;
  if (!Number.isFinite(available) || available < MIN_FREE_BYTES)
    throw Error("Not enough free disk space for installation and backup (requires at least 768 MiB)");
  return available;
}
async function writeProgress(phase, received = 0, total = null, startedAt = null) {
  const dest = path.join(state, "progress.json");
  const temp = path.join(state, "progress.tmp");
  let previous = {};
  try { previous = JSON.parse(await readFile(dest, "utf8")); } catch { /* first event */ }
  const data = {
    phase, received, total, startedAt: startedAt ?? previous.startedAt ?? new Date().toISOString(),
    at: new Date().toISOString()
  };
  await writeFile(temp, JSON.stringify(data) + "\n");
  await rename(temp, dest);
}
async function downloadOnce(sha, file, attempt) {
  const url = "https://github.com/Aspksa/AkariyaTenka/archive/" + sha + ".zip";
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!response.ok || !response.body) throw Error("GitHub download failed: HTTP " + response.status);
  const sizeText = response.headers.get("content-length");
  const total = sizeText && /^\\d+$/.test(sizeText) ? Number(sizeText) : null;
  if (total !== null && total > 40_000_000) throw Error("GitHub archive is too large");
  let received = 0, lastProgress = 0;
  await writeProgress("downloading", 0, total);
  const monitor = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > 40_000_000) { callback(Error("GitHub archive is too large")); return; }
      if (Date.now() - lastProgress > 400) {
        lastProgress = Date.now();
        writeProgress("downloading", received, total).then(() => callback(null, chunk), callback);
      } else callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), monitor, createWriteStream(file, { flags: "wx" }));
  await writeProgress("downloaded", received, total);
}
async function download(sha, file) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await assertUpdateDiskSpace();
      return await downloadOnce(sha, file, attempt);
    } catch (error) {
      lastError = error;
      await rm(file, { force: true }).catch(() => {});
      if (attempt >= 3 || /too large|disk space/i.test(String(error))) break;
      console.warn("Download interrupted; retry " + (attempt + 1) + "/3");
      await writeProgress("retrying");
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}
async function extractWindows(zip, destination) {
  const ps = path.join(root, "scripts", "github-extract.ps1");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, "-Archive", zip, "-Destination", destination], root);
}
async function probe(candidateRoot) {
  const server = net.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, [path.join(candidateRoot, "apps/server/dist/server.mjs")], {
    cwd: candidateRoot, stdio: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), AKARIYA_PORT: String(port), AKARIYA_HOST: "127.0.0.1" }
  });
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error("Updated backend exited before health check");
      try {
        const r = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(600) });
        if (r.ok) {
          const web = await fetch("http://127.0.0.1:" + port + "/", { signal: AbortSignal.timeout(1500) });
          if (web.ok) return;
        }
      } catch { /* booting */ }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw Error("Updated server health check timed out");
  } finally {
    if (child.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill("SIGTERM");
    }
  }
}
async function restore(backup, names, existed, installRoot = root) {
  // Validate all referenced paths before restoring any file.
  for (const name of names) {
    const original = path.join(backup, name);
    const destination = path.join(installRoot, name);
    if (existed[name] === true && !await exists(original) && !await exists(destination))
      throw Error("Missing original and backup for " + name + "; manual recovery required");
    if (await exists(original)) {
      const info = await lstat(original);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw Error("Unsafe backup entry: " + name);
    }
  }
  for (const name of [...names].reverse()) {
    const destination = path.join(installRoot, name);
    if (await exists(path.join(backup, name))) {
      await rm(destination, { recursive: true, force: true });
      await rename(path.join(backup, name), destination);
    } else if (existed[name] === false) await rm(destination, { recursive: true, force: true });
  }
}
async function restoreMarkers(backup, installRoot = root) {
  for (const marker of [".akariya-version", ".akariya-build.json"]) {
    const old = path.join(backup, marker);
    await rm(path.join(installRoot, marker), { force: true });
    if (await exists(old)) await copyFile(old, path.join(installRoot, marker));
  }
}
export async function pendingGithubUpdate(installRoot = root) {
  const pending = path.join(installRoot, ".runtime", "github-updater", "pending.json");
  if (!await exists(pending)) return null;
  await verifyUpdateFilesystem(installRoot);
  const pendingInfo = await lstat(pending);
  if (!pendingInfo.isFile() || pendingInfo.isSymbolicLink())
    throw Error("Unsafe update recovery journal");
  const record = JSON.parse(await readFile(pending, "utf8"));
  if (!record || typeof record.sha !== "string" || !SHA.test(record.sha)) return null;
  return record.sha;
}
export async function pruneGithubUpdateBackups(installRoot = root, retain = 3) {
  if (!Number.isSafeInteger(retain) || retain < 1) throw Error("Invalid backup retention");
  const directory = path.join(installRoot, ".runtime", "github-updater", "backups");
  if (!await exists(directory)) return [];
  await verifyUpdateFilesystem(installRoot);
  await assertOrdinaryDirectory(directory);
  const candidates = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entry.name)) continue;
    const folder = path.join(directory, entry.name);
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    const marker = path.join(folder, ".akariya-backup.json");
    if (!await exists(marker)) continue; // Never prune unrecognized legacy/user folders.
    const markerInfo = await lstat(marker);
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) continue;
    let record;
    try { record = JSON.parse(await readFile(marker, "utf8")); } catch { continue; }
    if (record?.kind !== "akariya-github-backup" || record?.schemaVersion !== 1) continue;
    candidates.push({ folder, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified || b.folder.localeCompare(a.folder));
  const removed = [];
  for (const candidate of candidates.slice(retain)) {
    await rm(candidate.folder, { recursive: true, force: false });
    removed.push(path.basename(candidate.folder));
  }
  return removed;
}
export async function confirmGithubUpdate(sha, installRoot = root) {
  if (!SHA.test(sha) || await pendingGithubUpdate(installRoot) !== sha)
    throw Error("Pending update confirmation SHA mismatch");
  await rm(path.join(installRoot, ".runtime", "github-updater", "pending.json"));
  await tryHistory("confirmed", sha, installRoot);
  try { await writeProgress("confirmed"); } catch { /* history remains authoritative */ }
  try { await pruneGithubUpdateBackups(installRoot); }
  catch (error) { console.warn("Backup pruning failed; update remains confirmed:", error); }
}
export async function recoverInterruptedUpdate(installRoot = root) {
  const recoverState = path.join(installRoot, ".runtime", "github-updater");
  const pending = path.join(recoverState, "pending.json");
  if (!await exists(pending)) return false;
  await verifyUpdateFilesystem(installRoot);
  const record = JSON.parse(await readFile(pending, "utf8"));
  const backupRoot = path.join(recoverState, "backups");
  const backupName = typeof record?.backup === "string" ? path.basename(record.backup) : "";
  if (!record || !Array.isArray(record.names) ||
      new Set(record.names).size !== record.names.length ||
      !record.names.every(n => allowed.includes(n) && typeof record.existed?.[n] === "boolean") ||
      (record.sha !== undefined && (typeof record.sha !== "string" || !SHA.test(record.sha))) ||
      typeof record.backup !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(backupName) ||
      record.backup !== path.join(backupRoot, backupName)) {
    throw Error("Update recovery metadata invalid; manual inspection required");
  }
  await assertOrdinaryDirectory(record.backup);
  for (const name of record.names) await verifyDestination(installRoot, name);
  await restore(record.backup, record.names, record.existed, installRoot);
  await restoreMarkers(record.backup, installRoot);
  await rm(pending, { force: true });
  await tryHistory("rolled_back", typeof record.sha === "string" && SHA.test(record.sha) ? record.sha : null, installRoot);
  if (installRoot === root) try { await writeProgress("rolled_back"); } catch { /* history remains authoritative */ }
  return true;
}
export async function applyGithubUpdate(sha) {
  if (!SHA.test(sha)) throw Error("Invalid pinned GitHub commit SHA");
  await mkdir(state, { recursive: true });
  await verifyUpdateFilesystem(root);
  const unlock = await acquireRuntimeLock(root);
  let swapped = false, backup, planned = [], existed = {};
  const work = path.join(state, "staging-" + randomUUID());
  try {
    await recoverInterruptedUpdate();
    await writeProgress("starting", 0, null, new Date().toISOString());
    await mkdir(work, { recursive: true });
    const zip = path.join(work, "source.zip");
    const extracted = path.join(work, "extracted");
    await mkdir(extracted);
    console.log("Downloading pinned GitHub revision", sha);
    await tryHistory("download_started", sha);
    await download(sha, zip);
    await writeProgress("validating");
    if (process.platform !== "win32") throw Error("GitHub ZIP installer currently supports Windows only");
    await extractWindows(zip, extracted);
    const folders = (await readdir(extracted, { withFileTypes: true })).filter(x => x.isDirectory());
    if (folders.length !== 1) throw Error("Unexpected GitHub archive layout");
    const staged = path.join(extracted, folders[0].name);
    await visit(staged);
    for (const name of ["AKARIYA.bat", "package.json", "package-lock.json", "scripts", "apps", "packages",
      "scripts/launch.mjs", "scripts/github-update.mjs", "scripts/runtime-lock.mjs"]) {
      if (!await exists(path.join(staged, name))) throw Error("Update is missing " + name);
    }
    console.log("Validating update in isolated folder");
    await run(process.platform === "win32" ? "cmd.exe" : "npm",
      process.platform === "win32" ? ["/d", "/s", "/c", "npm ci --no-audit --no-fund --ignore-scripts && npm run check"] : ["ci"],
      staged);
    for (const artifact of ["apps/server/dist/server.mjs", "apps/web/dist/index.html"]) {
      if (!await exists(path.join(staged, artifact))) throw Error("Validated build is missing " + artifact);
    }
    await tryHistory("validated", sha);
    console.log("Probing staged backend and web without modifying installation");
    await probe(staged);
    backup = path.join(state, "backups", randomUUID());
    await mkdir(backup, { recursive: true });
    await writeFile(path.join(backup, ".akariya-backup.json"), JSON.stringify({
      kind: "akariya-github-backup", schemaVersion: 1, previousVersion: "local", targetSha: sha
    }) + "\n", { flag: "wx", mode: 0o600 });
    await verifyUpdateFilesystem(root);
    const pending = path.join(state, "pending.json");
    // Preserve installation metadata as well as application code.
    for (const marker of [".akariya-version", ".akariya-build.json"]) {
      if (await exists(path.join(root, marker)))
        await copyFile(path.join(root, marker), path.join(backup, marker));
    }
    for (const name of allowed) {
      if (await exists(path.join(staged, name))) {
        planned.push(name);
        await verifyDestination(root, name);
        existed[name] = await exists(path.join(root, name));
      }
    }
    await writeFile(pending, JSON.stringify({ sha, backup, names: planned, existed }) + "\n", { flag: "wx", mode: 0o600 });
    swapped = true;
    await writeProgress("installing");
    for (const name of planned) {
      if (existed[name]) await rename(path.join(root, name), path.join(backup, name));
      await rename(path.join(staged, name), path.join(root, name));
    }
    await writeFile(path.join(root, ".akariya-version"), sha + "\n");
    await rm(path.join(root, ".akariya-build.json"), { force: true });
    await tryHistory("prepared", sha);
    await writeProgress("restarting");
    console.log("Update installed; awaiting confirmation from restarted launcher");
    return true;
  } catch (error) {
    console.error("[UPDATE ERROR]", error instanceof Error ? error.message : String(error));
    await tryHistory("failed", sha);
    await writeProgress("failed");
    if (swapped) {
      await restore(backup, planned, existed);
      await restoreMarkers(backup);
      await rm(path.join(state, "pending.json"), { force: true });
      console.error("Previous application files restored");
    }
    return false;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await unlock();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyGithubUpdate(process.argv[2] ?? "").then(ok => { process.exitCode = ok ? 0 : 1; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
