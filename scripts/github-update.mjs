import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, rename, lstat, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
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
async function download(sha, file) {
  const url = "https://github.com/Aspksa/AkariyaTenka/archive/" + sha + ".zip";
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!response.ok || !response.body) throw Error("GitHub archive download failed: " + response.status);
  let bytes = 0;
  const chunks = Readable.fromWeb(response.body);
  chunks.on("data", c => { bytes += c.length; if (bytes > 40_000_000) chunks.destroy(Error("Archive too large")); });
  await pipeline(chunks, createWriteStream(file, { flags: "wx" }));
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
async function restore(backup, names, existed) {
  for (const name of [...names].reverse()) {
    const destination = path.join(root, name);
    if (await exists(path.join(backup, name))) {
      await rm(destination, { recursive: true, force: true });
      await rename(path.join(backup, name), destination);
    } else if (existed[name] === false) await rm(destination, { recursive: true, force: true });
  }
}
async function restoreMarkers(backup) {
  for (const marker of [".akariya-version", ".akariya-build.json"]) {
    const old = path.join(backup, marker);
    await rm(path.join(root, marker), { force: true });
    if (await exists(old)) await copyFile(old, path.join(root, marker));
  }
}
export async function pendingGithubUpdate() {
  const pending = path.join(state, "pending.json");
  if (!await exists(pending)) return null;
  const record = JSON.parse(await readFile(pending, "utf8"));
  if (!record || typeof record.sha !== "string" || !SHA.test(record.sha)) return null;
  return record.sha;
}
export async function confirmGithubUpdate(sha) {
  if (!SHA.test(sha) || await pendingGithubUpdate() !== sha)
    throw Error("Pending update confirmation SHA mismatch");
  await rm(path.join(state, "pending.json"));
}
export async function recoverInterruptedUpdate() {
  const pending = path.join(state, "pending.json");
  if (!await exists(pending)) return false;
  const record = JSON.parse(await readFile(pending, "utf8"));
  if (!record || !Array.isArray(record.names) || !record.names.every(n => allowed.includes(n)) || !record.existed || typeof record.existed !== "object" ||
      typeof record.backup !== "string" || !record.backup.startsWith(path.join(state, "backups") + path.sep)) {
    throw Error("Update recovery metadata invalid; manual inspection required");
  }
  await restore(record.backup, record.names, record.existed);
  await restoreMarkers(record.backup);
  await rm(pending, { force: true });
  return true;
}
export async function applyGithubUpdate(sha) {
  if (!SHA.test(sha)) throw Error("Invalid pinned GitHub commit SHA");
  await mkdir(state, { recursive: true });
  const unlock = await acquireRuntimeLock(root);
  let swapped = false, backup, planned = [], existed = {};
  const work = path.join(state, "staging-" + randomUUID());
  try {
    await recoverInterruptedUpdate();
    await mkdir(work, { recursive: true });
    const zip = path.join(work, "source.zip");
    const extracted = path.join(work, "extracted");
    await mkdir(extracted);
    console.log("Downloading pinned GitHub revision", sha);
    await download(sha, zip);
    if (process.platform !== "win32") throw Error("GitHub ZIP installer currently supports Windows only");
    await extractWindows(zip, extracted);
    const folders = (await readdir(extracted, { withFileTypes: true })).filter(x => x.isDirectory());
    if (folders.length !== 1) throw Error("Unexpected GitHub archive layout");
    const staged = path.join(extracted, folders[0].name);
    await visit(staged);
    for (const name of ["AKARIYA.bat", "package.json", "package-lock.json", "scripts", "apps", "packages"]) {
      if (!await exists(path.join(staged, name))) throw Error("Update is missing " + name);
    }
    console.log("Validating update in isolated folder");
    await run(process.platform === "win32" ? "cmd.exe" : "npm",
      process.platform === "win32" ? ["/d", "/s", "/c", "npm ci --no-audit --no-fund --ignore-scripts && npm run check"] : ["ci"],
      staged);
    console.log("Probing staged backend and web without modifying installation");
    await probe(staged);
    backup = path.join(state, "backups", randomUUID());
    await mkdir(backup, { recursive: true });
    const pending = path.join(state, "pending.json");
    // Preserve installation metadata as well as application code.
    for (const marker of [".akariya-version", ".akariya-build.json"]) {
      if (await exists(path.join(root, marker)))
        await copyFile(path.join(root, marker), path.join(backup, marker));
    }
    for (const name of allowed) {
      if (await exists(path.join(staged, name))) {
        planned.push(name);
        existed[name] = await exists(path.join(root, name));
      }
    }
    await writeFile(pending, JSON.stringify({ sha, backup, names: planned, existed }) + "\n", { flag: "wx", mode: 0o600 });
    swapped = true;
    for (const name of planned) {
      if (existed[name]) await rename(path.join(root, name), path.join(backup, name));
      await rename(path.join(staged, name), path.join(root, name));
    }
    await writeFile(path.join(root, ".akariya-version"), sha + "\n");
    await rm(path.join(root, ".akariya-build.json"), { force: true });
    console.log("Update installed; awaiting confirmation from restarted launcher");
    return true;
  } catch (error) {
    console.error("[UPDATE ERROR]", error instanceof Error ? error.message : String(error));
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
