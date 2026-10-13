import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_MANIFEST_FILE = ".akariya-build.json";
const REQUIRED_ROOTS = ["apps/server/dist", "apps/web/dist"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

async function collectFiles(root, relativeDirectory) {
  const directory = path.join(root, ...relativeDirectory.split("/"));
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error("Prebuilt artifacts must not contain symbolic links");
    const relative = relativeDirectory + "/" + entry.name;
    if (entry.isDirectory()) output.push(...await collectFiles(root, relative));
    else if (entry.isFile()) output.push(relative);
    else throw new Error("Unsupported prebuilt artifact type: " + relative);
  }
  return output;
}

export async function createBuildManifest(root, sourceSha) {
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) throw new Error("sourceSha must be a 40-character Git SHA");
  const files = [];
  for (const requiredRoot of REQUIRED_ROOTS) files.push(...await collectFiles(root, requiredRoot));
  if (!files.includes("apps/server/dist/server.mjs")) throw new Error("Server bundle is missing");
  if (!files.includes("apps/web/dist/index.html")) throw new Error("Web build is missing");

  const artifacts = [];
  for (const relative of [...new Set(files)].sort()) {
    if (!safeRelativePath(relative)) throw new Error("Unsafe artifact path: " + relative);
    const absolute = path.join(root, ...relative.split("/"));
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Artifact is not a regular file: " + relative);
    const bytes = await readFile(absolute);
    artifacts.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
  }

  return {
    schemaVersion: 1,
    kind: "akariya-prebuilt",
    sourceSha,
    nodeMajorMin: 22,
    artifacts
  };
}

export async function writeBuildManifest(root, sourceSha) {
  const manifest = await createBuildManifest(root, sourceSha);
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(path.join(root, BUILD_MANIFEST_FILE), serialized, "utf8");
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const shaIndex = args.indexOf("--source-sha");
  if (rootIndex < 0 || shaIndex < 0 || !args[rootIndex + 1] || !args[shaIndex + 1]) {
    throw new Error("Usage: node scripts/build-manifest.mjs --root <release-root> --source-sha <git-sha>");
  }
  const root = path.resolve(args[rootIndex + 1]);
  const manifest = await writeBuildManifest(root, args[shaIndex + 1]);
  console.log("Prebuilt manifest ready:", manifest.artifacts.length, "artifacts");
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
