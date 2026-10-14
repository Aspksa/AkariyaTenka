import { createHash, randomUUID } from "node:crypto";
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
async function probe() {
  const server = net.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  await new Promise(resolve => server.close(resolve));
  const child = spawn(process.execPath, [path.join(root, "apps/server/dist/server.mjs")], {
    cwd: root, stdio: "ignore", windowsHide: true,
    env: { ...process.env, PORT: String(port), AKARIYA_PORT: String(port), AKARIYA_HOST: "127.0.0.1" }
  });
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error("Updated backend exited before health check");
      try {
        const r = await fetch("http://127.0.0.1:" + port + "/api/health", { signal: AbortSignal.timeout(600) });
        if (r.ok) return;
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
async function restore(backup, names) {
  for (const name of [...names].reverse()) {
    const destination = path.join(root, name);
    await rm(destination, { recursive: true, force: true });
    if (await exists(path.join(backup, name))) await rename(path.join(backup, name), destination);
  }
}
export async function recoverInterruptedUpdate() {
  const pending = path.join(state, "pending.json");
  if (!await exists(pending)) return false;
  const record = JSON.parse(await readFile(pending, "utf8"));
  if (!record || !Array.isArray(record.names) || !record.names.every(n => allowed.includes(n)) ||
      typeof record.backup !== "string" || !record.backup.startsWith(path.join(state, "backups") + path.sep)) {
    throw Error("Update recovery metadata invalid; manual inspection required");
  }
  await restore(record.backup, record.names);
  await rm(pending, { force: true });
  return true;
}
export async function applyGithubUpdate(sha) {
  if (!SHA.test(sha)) throw Error("Invalid pinned GitHub commit SHA");
  await mkdir(state, { recursive: true });
  const unlock = await acquireRuntimeLock(root);
  let swapped = false, moved = [], backup;
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
    backup = path.join(state, "backups", randomUUID());
    await mkdir(backup, { recursive: true });
    const names = allowed.filter(n => /* Don't overwrite absent source paths. */ true);
    const pending = path.join(state, "pending.json");
    // Journal is written before any destination is renamed. Recovery only
    // includes the completed moves, avoiding removal of untouched paths.
    await writeFile(pending, JSON.stringify({ backup, names: moved }) + "\n", { flag: "wx", mode: 0o600 });
    swapped = true;
    for (const name of names) {
      if (!await exists(path.join(staged, name))) continue;
      if (await exists(path.join(root, name))) await rename(path.join(root, name), path.join(backup, name));
      moved.push(name);
      await writeFile(pending, JSON.stringify({ backup, names: moved }) + "\n");
      await rename(path.join(staged, name), path.join(root, name));
    }
    await writeFile(path.join(root, ".akariya-version"), sha + "\n");
    await rm(path.join(root, ".akariya-build.json"), { force: true });
    console.log("Running installed server health probe");
    await probe();
    await rm(pending, { force: true });
    console.log("Update installed and health-confirmed");
    return true;
  } catch (error) {
    console.error("[UPDATE ERROR]", error instanceof Error ? error.message : String(error));
    if (swapped) {
      await restore(backup, moved);
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
