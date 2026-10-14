import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readFile, mkdir, writeFile, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { gitBlobHash, safeUpdatePath, atomicWriteFile } from "./apply-update.mjs";

const MAX_ZIP = 256 * 1024 * 1024;
const MAX_FILES = 2500;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/i;
const SIGNATURE = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function crc32(bytes) {
  let c = 0xffffffff;
  for (const value of bytes) {
    c ^= value;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function inspectReleaseZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_ZIP || bytes.length < 22) throw new Error("Invalid ZIP size");
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === SIGNATURE && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      eocd = i; break;
    }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6)) throw new Error("Unsupported ZIP structure");
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0 || count > MAX_FILES || centralOffset + centralSize > eocd) throw new Error("Invalid ZIP directory");
  const results = [];
  const seen = new Set();
  let total = 0, cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== CENTRAL) throw new Error("Invalid ZIP entry");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const offset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || compressed === 0xffffffff || expanded === 0xffffffff || offset === 0xffffffff) throw new Error("Unsupported ZIP64 or entry bounds");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const rawName = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    // The release workflow uses `zip -r archive .`, which prefixes entries with "./".
    const name = rawName.startsWith("./") ? rawName.slice(2) : rawName;
    cursor = end;
    if ((flags & 1) !== 0 || (flags & ~0x808) !== 0 || ![0,8].includes(method)) throw new Error("Unsupported ZIP encryption or compression");
    const unixType = (external >>> 16) & 0xf000;
    if (unixType && ![0x8000,0x4000].includes(unixType)) throw new Error("Symlinks and special ZIP entries are forbidden");
    const directory = name.endsWith("/");
    if (directory) {
      const dirName = name.slice(0, -1);
      if (dirName && !safeUpdatePath(dirName)) throw new Error("Unsafe ZIP directory: " + name);
      continue;
    }
    if (!safeUpdatePath(name)) {
      // The generated release contains a managed version marker, not an installable payload.
      if (name === ".akariya-version") continue;
      throw new Error("Unsafe ZIP path: " + name);
    }
    if (name === ".akariya-build.json") {
      // Handled as an authenticated prebuilt metadata file, not an installable source.
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate ZIP path");
    seen.add(key);
    if (expanded > MAX_FILE || total + expanded > MAX_TOTAL) throw new Error("ZIP decompression limit exceeded");
    total += expanded;
    if (offset + 30 > centralOffset || bytes.readUInt32LE(offset) !== LOCAL) throw new Error("ZIP local header mismatch");
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    if (bytes.readUInt16LE(offset + 8) !== method ||
        !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(nameBytes)) throw new Error("ZIP local entry mismatch");
    const start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > centralOffset) throw new Error("ZIP overlapping entry");
    const raw = bytes.subarray(start, start + compressed);
    const content = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_FILE });
    if (content.length !== expanded || crc32(content) !== expectedCrc) throw new Error("ZIP entry integrity mismatch: " + name);
    results.push({ path: name, bytes: content });
  }
  if (cursor !== centralOffset + centralSize) throw new Error("ZIP central directory size mismatch");
  return results;
}

export async function prepareTrustedRelease({ root, archivePath, trustedSha256, sourceSha }) {
  if (!HEX64.test(trustedSha256 ?? "") || !HEX40.test(sourceSha ?? "")) throw new Error("Independent trusted release digest and source commit are required");
  const archive = await readFile(archivePath);
  if (createHash("sha256").update(archive).digest("hex") !== trustedSha256.toLowerCase()) throw new Error("Trusted archive digest mismatch");
  const entries = inspectReleaseZip(archive);
  const metaFile = entries.find((entry) => entry.path === ".akariya-build.json");
  if (!metaFile) throw new Error("Missing prebuilt manifest");
  const meta = JSON.parse(metaFile.bytes.toString("utf8"));
  if (meta.kind !== "akariya-prebuilt" || meta.schemaVersion !== 1 || meta.sourceSha !== sourceSha ||
      meta.nodeMajorMin !== 22 || !Array.isArray(meta.artifacts)) throw new Error("Invalid prebuilt manifest");
  const byPath = new Map(entries.map((entry) => [entry.path, entry.bytes]));
  if (!byPath.has("apps/server/dist/server.mjs") || !byPath.has("apps/web/dist/index.html")) throw new Error("Required release artifacts missing");
  const artifactPaths = new Set();
  for (const artifact of meta.artifacts) {
    if (!safeUpdatePath(artifact.path) || artifactPaths.has(artifact.path) ||
        !Number.isSafeInteger(artifact.size) || !HEX64.test(artifact.sha256 ?? "")) throw new Error("Invalid artifact listing");
    artifactPaths.add(artifact.path);
    const body = byPath.get(artifact.path);
    if (!body || body.length !== artifact.size ||
        createHash("sha256").update(body).digest("hex") !== artifact.sha256.toLowerCase()) throw new Error("Prebuilt artifact mismatch");
  }
  const allArtifacts = [...byPath.keys()].filter((name) => name.startsWith("apps/server/dist/") || name.startsWith("apps/web/dist/"));
  if (allArtifacts.some((name) => !artifactPaths.has(name))) throw new Error("Unlisted build artifact");
  const updates = path.join(root, ".updates");
  await mkdir(updates, { recursive: true });
  const ready = path.join(updates, "ready.json");
  try { await lstat(ready); throw new Error("Another update is already pending"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temp = path.join(updates, "staging-new-" + process.pid + "-" + Date.now());
  const staging = path.join(updates, "staging");
  try { await lstat(staging); throw new Error("Staging already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const manifest = { sha: sourceSha, files: entries.map((entry) => ({ path: entry.path, sha: gitBlobHash(entry.bytes) })) };
  try {
    await mkdir(temp, { recursive: false });
    for (const entry of entries) {
      const target = path.join(temp, ...entry.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.bytes, { flag: "wx" });
    }
    await rename(temp, staging);
    await atomicWriteFile(ready, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
    return { sha: sourceSha, files: manifest.files.length, staging };
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
    // Staging remains for diagnosis if ready.json cannot be written.
    throw error;
  }
}
