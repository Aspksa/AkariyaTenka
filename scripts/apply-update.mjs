import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PROTECTED_SEGMENTS = new Set([
  ".git",
  ".updates",
  ".env",
  "data",
  ".runtime",
  "node_modules",
  ".akariya-version",
  ".secrets",
  "secrets",
]);
const GIT_SHA = /^[0-9a-f]{40}$/;
const BACKUP_NAME = /^\d{13}-[0-9a-f]{8}$/;
const KEEP_BACKUPS = 3;
const INVALID_WINDOWS_CHARS = /[<>:"|?*\0]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const readOrNull = (file) => readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
const normalizeCase = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const normalizeManifestPath = (value) => value.toLowerCase();

export function safeUpdatePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length >= 1024) return false;
  if (value.startsWith("/") || value.includes("\\") || INVALID_WINDOWS_CHARS.test(value)) return false;
  const parts = value.split("/");
  return parts.every((segment) => {
    const lower = segment.toLowerCase();
    return segment.length > 0 && segment !== "." && segment !== ".." &&
      !PROTECTED_SEGMENTS.has(lower) && !WINDOWS_RESERVED.test(segment) && !/[. ]$/.test(segment);
  });
}

export function gitBlobHash(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function isInside(root, candidate) {
  const normalizedRoot = normalizeCase(path.resolve(root));
  const normalizedCandidate = normalizeCase(path.resolve(candidate));
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

async function assertNoFilesystemIndirection(root, relativePath, { requireLeaf = false } = {}) {
  if (!safeUpdatePath(relativePath)) throw new Error(`Unsafe update path: ${relativePath}`);
  const canonicalRoot = await realpath(root);
  let current = root;
  const parts = relativePath.split("/");

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const isLeaf = index === parts.length - 1;
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Filesystem indirection is not allowed: ${relativePath}`);
      if (!isLeaf && !stat.isDirectory()) throw new Error(`Unsafe update path chain: ${relativePath}`);
      if (isLeaf && !stat.isFile()) throw new Error(`Unsafe update destination type: ${relativePath}`);
      const canonicalCurrent = await realpath(current);
      if (!isInside(canonicalRoot, canonicalCurrent)) throw new Error(`Update path escapes project root: ${relativePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (requireLeaf) throw new Error(`Staged update file is missing: ${relativePath}`);
      break;
    }
  }
}

export async function atomicWriteFile(file, bytes) {
  const temporary = `${file}.akariya-update-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function appendJsonl(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`);
}

async function addHistory(folder, item) {
  await appendJsonl(path.join(folder, "history.jsonl"), {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...item,
  }).catch(() => {});
}

async function addEvent(folder, operationId, type, status, extra = {}) {
  await appendJsonl(path.join(folder, "events.jsonl"), {
    eventId: randomUUID(),
    operationId,
    timestamp: new Date().toISOString(),
    type,
    status,
    ...extra,
  });
}

function validateManifest(manifest) {
  if (!manifest || !GIT_SHA.test(manifest.sha) || !Array.isArray(manifest.files) || manifest.files.length > 2500) {
    throw new Error("Update manifest is invalid or unsafe");
  }

  const fileKeys = new Set();
  for (const file of manifest.files) {
    if (!file || !safeUpdatePath(file.path) || !GIT_SHA.test(file.sha)) throw new Error("Update manifest is invalid or unsafe");
    const key = normalizeManifestPath(file.path);
    if (fileKeys.has(key)) throw new Error(`Duplicate update path: ${file.path}`);
    fileKeys.add(key);
  }

  if (manifest.removals !== undefined) {
    if (!Array.isArray(manifest.removals) || manifest.removals.length > 2500) throw new Error("Update removals are invalid");
    const removalKeys = new Set();
    for (const removal of manifest.removals) {
      if (!safeUpdatePath(removal)) throw new Error(`Unsafe removal path: ${String(removal)}`);
      const key = normalizeManifestPath(removal);
      if (removalKeys.has(key) || fileKeys.has(key)) throw new Error(`Duplicate or conflicting update path: ${removal}`);
      removalKeys.add(key);
    }
  }
}

async function confirmedRemovals(folder, manifest) {
  if (!manifest.removals?.length) return [];
  const raw = await readOrNull(path.join(folder, "removals-confirmed.json"));
  if (!raw) return [];
  let confirmation;
  try { confirmation = JSON.parse(raw); } catch { return []; }
  if (confirmation?.sha !== manifest.sha || !Array.isArray(confirmation.paths)) return [];
  const allowed = new Set(confirmation.paths.filter(safeUpdatePath));
  return manifest.removals.filter((item) => allowed.has(item));
}

export async function defaultHealthCheck(root, files) {
  for (const file of files) {
    const installed = await readFile(path.join(root, file.path));
    if (gitBlobHash(installed) !== file.sha) throw new Error(`Installed file hash mismatch: ${file.path}`);
    if (file.path === "package.json" || file.path === "package-lock.json") JSON.parse(installed.toString("utf8"));
    if (/^scripts\/[^/]+\.mjs$/.test(file.path)) {
      const check = spawnSync(process.execPath, ["--check", path.join(root, file.path)], { encoding: "utf8" });
      if (check.status !== 0) throw new Error(`Installed launcher script has invalid syntax: ${file.path}`);
    }
  }
}

async function restoreFiles(root, backup, changes, oldVersion, oldInstalled) {
  const failures = [];
  for (const change of [...changes].reverse()) {
    const destination = path.join(root, change.path);
    try {
      await assertNoFilesystemIndirection(root, change.path);
      if (change.existed) {
        await mkdir(path.dirname(destination), { recursive: true });
        await assertNoFilesystemIndirection(root, change.path);
        await atomicWriteFile(destination, await readFile(path.join(backup, change.path)));
      } else {
        await rm(destination, { force: true });
      }
    } catch (error) {
      failures.push(`${change.path}: ${String(error?.message ?? error)}`);
    }
  }

  try {
    const versionFile = path.join(root, ".akariya-version");
    if (oldVersion === null) await rm(versionFile, { force: true });
    else await atomicWriteFile(versionFile, Buffer.from(oldVersion));
    const installedFile = path.join(root, ".updates", "installed.json");
    if (oldInstalled === null) await rm(installedFile, { force: true });
    else await atomicWriteFile(installedFile, Buffer.from(oldInstalled));
  } catch (error) {
    failures.push(`version metadata: ${String(error?.message ?? error)}`);
  }
  return failures;
}

function validateBackupMetadata(meta) {
  if (!meta || !GIT_SHA.test(meta.updateSha) || !Array.isArray(meta.changes)) return false;
  const seen = new Set();
  return meta.changes.every((change) => {
    if (!change || !safeUpdatePath(change.path) || typeof change.existed !== "boolean") return false;
    const key = normalizeManifestPath(change.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function pruneUpdateFolder(folder, keep = KEEP_BACKUPS) {
  try {
    const backupsDir = path.join(folder, "backups");
    const names = (await readdir(backupsDir)).filter((name) => BACKUP_NAME.test(name)).sort();
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      await rm(path.join(backupsDir, name), { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    const failed = (await readdir(folder)).filter((name) => /^ready\.failed-\d+\.json$/.test(name)).sort();
    for (const name of failed.slice(0, Math.max(0, failed.length - keep))) {
      await rm(path.join(folder, name), { force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function rollbackInstall(root, backupName, { kind = "rollback", message = "" } = {}) {
  if (typeof backupName !== "string" || !BACKUP_NAME.test(backupName)) throw new Error("Invalid backup name");
  const folder = path.join(root, ".updates");
  const backup = path.join(folder, "backups", backupName);
  let meta;
  try { meta = JSON.parse(await readFile(path.join(backup, ".meta.json"), "utf8")); }
  catch { throw new Error("Backup metadata is missing or damaged"); }
  if (!validateBackupMetadata(meta)) throw new Error("Backup metadata is damaged");

  const operationId = `rollback-${randomUUID()}`;
  const currentVersion = (await readOrNull(path.join(root, ".akariya-version")) ?? "").trim();
  await addEvent(folder, operationId, "rollback_started", "rolling_back", { reason: kind }).catch(() => {});
  const failures = await restoreFiles(root, backup, meta.changes, meta.oldVersion ?? null, meta.oldInstalled ?? null);
  if (failures.length > 0) {
    await addEvent(folder, operationId, "rollback_failed", "failed", { reason: kind, message: failures.join("; ") }).catch(() => {});
    throw new AggregateError(failures, "Rollback completed with errors");
  }

  await rm(path.join(folder, "pending-confirm.json"), { force: true });
  await addEvent(folder, operationId, "rollback_done", "rolled_back", { reason: kind }).catch(() => {});
  await addHistory(folder, {
    kind,
    from: currentVersion,
    to: String(meta.oldVersion ?? "").trim(),
    rollbackOf: backupName,
    updateSha: meta.updateSha,
    ...(message ? { message: String(message).slice(0, 300) } : {}),
  });
  return true;
}

export async function applyRollbackRequest(root) {
  const requestFile = path.join(root, ".updates", "rollback-request.json");
  const raw = await readOrNull(requestFile);
  if (raw === null) return false;
  let request;
  try { request = JSON.parse(raw); } catch { throw new Error("Rollback request is damaged"); }
  const result = await rollbackInstall(root, request?.backup, { kind: "rollback" });
  await rm(requestFile, { force: true });
  return result;
}

export async function confirmUpdate(root) {
  const folder = path.join(root, ".updates");
  const pendingFile = path.join(folder, "pending-confirm.json");
  const raw = await readOrNull(pendingFile);
  if (raw === null) return false;
  let pending;
  try { pending = JSON.parse(raw); } catch { throw new Error("Pending update confirmation is damaged"); }
  if (!pending || !BACKUP_NAME.test(pending.backup) || !GIT_SHA.test(pending.sha)) throw new Error("Pending update confirmation is invalid");
  await addEvent(folder, `confirm-${randomUUID()}`, "update_confirmed", "confirmed", { sha: pending.sha }).catch(() => {});
  await rm(pendingFile, { force: true });
  return true;
}

export async function rollbackFailedStart(root, message) {
  const pendingFile = path.join(root, ".updates", "pending-confirm.json");
  const raw = await readOrNull(pendingFile);
  if (raw === null) return false;
  let pending;
  try { pending = JSON.parse(raw); } catch { throw new Error("Pending update confirmation is damaged"); }
  if (!pending || !BACKUP_NAME.test(pending.backup) || !GIT_SHA.test(pending.sha)) throw new Error("Pending update confirmation is invalid");
  return rollbackInstall(root, pending.backup, { kind: "startup_failed", message: String(message ?? "").slice(0, 300) });
}

export async function applyPreparedUpdate(root, { healthCheck = defaultHealthCheck } = {}) {
  const folder = path.join(root, ".updates");
  const manifestFile = path.join(folder, "ready.json");
  if (!existsSync(manifestFile)) return false;

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  validateManifest(manifest);
  const removals = await confirmedRemovals(folder, manifest);
  const staging = path.join(folder, "staging");
  const backupName = `${String(Date.now()).padStart(13, "0")}-${randomUUID().slice(0, 8)}`;
  const backup = path.join(folder, "backups", backupName);
  const operationId = `install-${randomUUID()}`;
  const versionFile = path.join(root, ".akariya-version");
  const installedFile = path.join(folder, "installed.json");
  const oldVersion = await readOrNull(versionFile);
  const oldInstalled = await readOrNull(installedFile);
  const prepared = [];
  const changes = [];

  try {
    await mkdir(folder, { recursive: true });
    await realpath(root);
    await realpath(staging);

    // Phase 1: validate every staged file and every destination before changing installation state.
    for (const file of manifest.files) {
      await assertNoFilesystemIndirection(staging, file.path, { requireLeaf: true });
      await assertNoFilesystemIndirection(root, file.path);
      const bytes = await readFile(path.join(staging, file.path));
      if (gitBlobHash(bytes) !== file.sha) throw new Error(`Staged file hash mismatch: ${file.path}`);
      const same = await readFile(path.join(root, file.path)).then((current) => gitBlobHash(current) === file.sha, () => false);
      prepared.push({ ...file, bytes, same });
      await addEvent(folder, operationId, "file_verified", "verified", { path: file.path });
    }

    for (const removal of removals) await assertNoFilesystemIndirection(root, removal);

    // Phase 2: prepare a complete rollback backup before the first installed file changes.
    await mkdir(backup, { recursive: true });
    await addEvent(folder, operationId, "backup_started", "backing_up", { backup: backupName });

    for (const file of prepared.filter((item) => !item.same)) {
      const destination = path.join(root, file.path);
      let existed = false;
      try {
        const stat = await lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe update destination: ${file.path}`);
        const saved = path.join(backup, file.path);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(destination, saved);
        existed = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      changes.push({ path: file.path, existed });
    }

    const removalsToApply = [];
    for (const removal of removals) {
      const destination = path.join(root, removal);
      try {
        const stat = await lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe removal destination: ${removal}`);
        const saved = path.join(backup, removal);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(destination, saved);
        changes.push({ path: removal, existed: true });
        removalsToApply.push(removal);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    await atomicWriteFile(path.join(backup, ".meta.json"), Buffer.from(JSON.stringify({
      updateSha: manifest.sha,
      timestamp: new Date().toISOString(),
      changes,
      oldVersion,
      oldInstalled,
      installedManifest: manifest.files.map((file) => file.path),
    }, null, 2)));
    await addEvent(folder, operationId, "backup_completed", "backed_up", { backup: backupName, files: changes.length });

    // Phase 3: install using adjacent temporary files + rename. Re-check path chains immediately before writes.
    for (const file of prepared.filter((item) => !item.same)) {
      const destination = path.join(root, file.path);
      await assertNoFilesystemIndirection(root, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await assertNoFilesystemIndirection(root, file.path);
      await atomicWriteFile(destination, file.bytes);
      await addEvent(folder, operationId, "file_installed", "installed", { path: file.path });
    }

    for (const removal of removalsToApply) {
      await assertNoFilesystemIndirection(root, removal);
      await rm(path.join(root, removal));
      await addEvent(folder, operationId, "file_removed", "removed", { path: removal });
    }

    await addEvent(folder, operationId, "post_install_check_started", "checking");
    await healthCheck(root, manifest.files);
    await addEvent(folder, operationId, "post_install_check_completed", "healthy");

    await atomicWriteFile(versionFile, Buffer.from(`${manifest.sha}\n`));
    await atomicWriteFile(installedFile, Buffer.from(JSON.stringify({ sha: manifest.sha, paths: manifest.files.map((file) => file.path) }, null, 2)));
    await atomicWriteFile(path.join(folder, "pending-confirm.json"), Buffer.from(JSON.stringify({ backup: backupName, sha: manifest.sha })));
    await rm(path.join(folder, "removals-confirmed.json"), { force: true }).catch(() => {});
    // Removing ready.json is part of the transaction commit: a failed removal must roll the install back,
    // so the launcher can quarantine the still-present manifest instead of retrying it forever.
    await rm(manifestFile);
    await addEvent(folder, operationId, "install", "installed", { sha: manifest.sha, backup: backupName }).catch(() => {});
    await addHistory(folder, {
      kind: "install",
      from: (oldVersion ?? "").trim(),
      to: manifest.sha,
      updateSha: manifest.sha,
      backup: backupName,
      files: changes.length,
    });
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(path.join(folder, "staging.sha"), { force: true }).catch(() => {});
    await pruneUpdateFolder(folder).catch(() => {});
    return true;
  } catch (error) {
    await addEvent(folder, operationId, "failed", "failed", { message: String(error?.message ?? error).slice(0, 300) }).catch(() => {});
    const failures = await restoreFiles(root, backup, changes, oldVersion, oldInstalled);
    if (failures.length > 0) {
      await addEvent(folder, operationId, "rollback_failed", "failed", { message: failures.join("; ") }).catch(() => {});
      throw new AggregateError([error, ...failures], "Update failed and rollback was incomplete");
    }
    await rm(path.join(folder, "pending-confirm.json"), { force: true }).catch(() => {});
    await addEvent(folder, operationId, "rollback", "rolled_back", { reason: "install_failed" }).catch(() => {});
    await addHistory(folder, {
      kind: "failed",
      from: (oldVersion ?? "").trim(),
      to: manifest?.sha ?? "",
      updateSha: manifest?.sha ?? "",
      message: String(error?.message ?? error).slice(0, 300),
    });
    throw error;
  }
}
