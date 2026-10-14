import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

const RELEASES_API = "https://api.github.com/repos/Aspksa/AkariyaTenka/releases/latest";
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const RELEASE_ASSET = "AkariyaTenka.zip";
const CHECKSUM_ASSET = "AkariyaTenka.zip.sha256";

export function parseVersion(tag) {
  const match = TAG_RE.exec(tag);
  if (!match) throw new Error("Unsupported release tag");
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (const key of ["major", "minor", "patch"]) {
    if (x[key] !== y[key]) return Math.sign(x[key] - y[key]);
  }
  if (x.prerelease === null) return y.prerelease === null ? 0 : 1;
  if (y.prerelease === null) return -1;
  return x.prerelease.localeCompare(y.prerelease);
}

function approvedHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.hostname !== "github.com" && url.hostname !== "api.github.com" &&
      url.hostname !== "objects.githubusercontent.com" &&
      !url.hostname.endsWith(".release-assets.githubusercontent.com")) {
    throw new Error("Untrusted release URL");
  }
  return url;
}

async function request(url, { fetchImpl, signal }) {
  approvedHttpsUrl(url);
  const response = await fetchImpl(url, {
    signal, redirect: "manual",
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "AkariyaTenka-UpdateManager" }
  });
  // Redirects are checked on every hop; never forward bearer tokens or cookies.
  return response;
}

async function getResponse(url, options) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const response = await request(current, options);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("Release redirect is missing Location");
      current = new URL(next, current).toString();
      approvedHttpsUrl(current);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error(`Release request failed (HTTP ${response.status})`);
    return response;
  }
  throw new Error("Too many release redirects");
}

async function readBounded(response, maximum) {
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error("Missing release response body");
  for await (const chunk of Readable.fromWeb(response.body)) {
    size += chunk.length;
    if (size > maximum) throw new Error("Release response exceeds limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assetOf(release, name) {
  const matches = release.assets.filter((asset) => asset?.name === name);
  if (matches.length !== 1 || !matches[0].browser_download_url) throw new Error(`Missing or duplicate release asset: ${name}`);
  approvedHttpsUrl(matches[0].browser_download_url);
  return matches[0];
}

export async function checkLatestRelease({ fetchImpl = fetch, signal } = {}) {
  const response = await getResponse(RELEASES_API, { fetchImpl, signal });
  const release = JSON.parse(await readBounded(response, MAX_METADATA_BYTES));
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== "string" ||
      !Array.isArray(release.assets)) throw new Error("Release metadata is invalid");
  parseVersion(release.tag_name);
  const archive = assetOf(release, RELEASE_ASSET);
  const checksum = assetOf(release, CHECKSUM_ASSET);
  return Object.freeze({
    tag: release.tag_name,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    releaseUrl: `https://github.com/Aspksa/AkariyaTenka/releases/tag/${encodeURIComponent(release.tag_name)}`,
    archiveUrl: archive.browser_download_url,
    checksumUrl: checksum.browser_download_url,
    archiveSize: Number.isSafeInteger(archive.size) ? archive.size : null
  });
}

export function parseChecksum(text) {
  const lines = text.trim().split(/\r?\n/);
  const matches = lines.map((line) => /^([a-f0-9]{64})\s+\*?AkariyaTenka\.zip$/i.exec(line)).filter(Boolean);
  if (matches.length !== 1) throw new Error("Invalid SHA-256 checksum manifest");
  return matches[0][1].toLowerCase();
}

// Download only. No installation, extraction or ready.json creation is performed here.
// Callers must separately authenticate the release publisher before approving installation.
export async function downloadVerifiedRelease({ release, updatesDir, fetchImpl = fetch, signal, onProgress = () => {} }) {
  if (!release || typeof release.tag !== "string") throw new Error("Release is required");
  parseVersion(release.tag);
  const metadata = await checkLatestRelease({ fetchImpl, signal });
  if (metadata.tag !== release.tag) throw new Error("Release changed since selection");
  if (metadata.archiveSize !== null && metadata.archiveSize > MAX_ARCHIVE_BYTES) throw new Error("Release archive too large");
  const checksumResponse = await getResponse(metadata.checksumUrl, { fetchImpl, signal });
  const expectedHash = parseChecksum(await readBounded(checksumResponse, 4096));
  if (!SHA256_RE.test(expectedHash)) throw new Error("Invalid SHA-256");
  const folder = path.resolve(updatesDir, "downloads");
  await mkdir(folder, { recursive: true });
  const finalPath = path.join(folder, `${metadata.tag}-AkariyaTenka.zip`);
  const tempPath = path.join(folder, `.${metadata.tag}-${process.pid}-${Date.now()}.part`);
  let transferred = 0;
  const digest = createHash("sha256");
  try {
    const archiveResponse = await getResponse(metadata.archiveUrl, { fetchImpl, signal });
    if (!archiveResponse.body) throw new Error("Missing archive body");
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        transferred += chunk.length;
        if (transferred > MAX_ARCHIVE_BYTES) return callback(new Error("Release archive exceeds limit"));
        digest.update(chunk);
        onProgress({ receivedBytes: transferred, totalBytes: metadata.archiveSize });
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(archiveResponse.body), limiter, createWriteStream(tempPath, { flags: "wx", mode: 0o600 }), { signal });
    if (metadata.archiveSize !== null && transferred !== metadata.archiveSize) throw new Error("Release archive size mismatch");
    if (digest.digest("hex") !== expectedHash) throw new Error("Release archive checksum mismatch");
    await rename(tempPath, finalPath);
    return { file: finalPath, sha256: expectedHash, bytes: transferred, tag: metadata.tag };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
