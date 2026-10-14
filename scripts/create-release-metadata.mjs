import { createHash } from "node:crypto";
import { open, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalReleasePayload } from "./release-trust.mjs";

export async function createReleaseMetadata({ archivePath, tag, sourceSha }) {
  const details = await stat(archivePath);
  if (!details.isFile() || details.size <= 0 || details.size > 256 * 1024 * 1024) {
    throw new Error("Invalid release ZIP size");
  }
  const hash = createHash("sha256");
  const handle = await open(archivePath, "r");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await handle.close();
  }
  const manifest = {
    schemaVersion: 1,
    repository: "Aspksa/AkariyaTenka",
    tag,
    sourceSha,
    archiveSha256: hash.digest("hex"),
    archiveSize: details.size
  };
  canonicalReleasePayload(manifest);
  return manifest;
}

async function main() {
  const [archivePath, tag, sourceSha, outputPath] = process.argv.slice(2);
  if (!archivePath || !tag || !sourceSha || !outputPath) {
    throw new Error("Usage: node scripts/create-release-metadata.mjs ZIP vX.Y.Z COMMIT_SHA OUTPUT_JSON");
  }
  const metadata = await createReleaseMetadata({ archivePath, tag, sourceSha });
  await writeFile(outputPath, JSON.stringify(metadata, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
