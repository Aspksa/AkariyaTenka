import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { BUILD_MANIFEST_FILE } from "./build-manifest.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;

function safeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

export async function loadPrebuiltManifest(root) {
  let raw;
  try {
    raw = await readFile(path.join(root, BUILD_MANIFEST_FILE), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  let manifest;
  try { manifest = JSON.parse(raw); }
  catch { throw new Error("Prebuilt manifest is not valid JSON"); }

  if (
    manifest?.schemaVersion !== 1
    || manifest?.kind !== "akariya-prebuilt"
    || !SHA1.test(manifest?.sourceSha ?? "")
    || !Number.isSafeInteger(manifest?.nodeMajorMin)
    || manifest.nodeMajorMin < 20
    || !Array.isArray(manifest?.artifacts)
    || manifest.artifacts.length === 0
  ) {
    throw new Error("Prebuilt manifest is invalid");
  }

  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    if (
      !safeRelativePath(artifact?.path)
      || !Number.isSafeInteger(artifact?.size)
      || artifact.size < 0
      || !SHA256.test(artifact?.sha256 ?? "")
    ) throw new Error("Prebuilt manifest contains an invalid artifact");

    const key = artifact.path.toLowerCase();
    if (seen.has(key)) throw new Error("Prebuilt manifest contains duplicate artifact paths");
    seen.add(key);
  }

  return manifest;
}

export async function verifyPrebuilt(root) {
  const manifest = await loadPrebuiltManifest(root);
  if (manifest === null) return null;

  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < manifest.nodeMajorMin) {
    throw new Error("Prebuilt release requires Node.js " + manifest.nodeMajorMin + "+; found " + process.version);
  }

  for (const artifact of manifest.artifacts) {
    const absolute = path.resolve(root, ...artifact.path.split("/"));
    const rootPath = path.resolve(root);
    if (!absolute.startsWith(rootPath + path.sep)) throw new Error("Prebuilt artifact escapes project root");

    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.size) {
      throw new Error("Prebuilt artifact metadata mismatch: " + artifact.path);
    }
    const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
    if (digest !== artifact.sha256) throw new Error("Prebuilt artifact hash mismatch: " + artifact.path);
  }

  return manifest;
}
