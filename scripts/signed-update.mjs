import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RELEASES_API, getResponse, readBounded, assetOf, downloadVerifiedRelease } from "./update-manager.mjs";
import { verifySignedRelease, assertMatchingDownloadedRelease } from "./release-trust.mjs";
import { prepareTrustedRelease } from "./prepare-update.mjs";

const MANIFEST = "AkariyaTenka.release.json";
const SIGNATURE = "AkariyaTenka.release.sig";

// Public key and fingerprint are provisioned in an independently trusted installation.
// Never source either trust anchor from the GitHub release response.
export async function discoverSignedUpdate({
  publicKeyPem, trustedPublicKeySpkiSha256, fetchImpl = fetch, signal
}) {
  if (!publicKeyPem || !trustedPublicKeySpkiSha256) throw new Error("Publisher trust anchor is not configured");
  const response = await getResponse(RELEASES_API, { fetchImpl, signal });
  const release = JSON.parse(await readBounded(response, 256 * 1024));
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets) ||
      typeof release.tag_name !== "string") throw new Error("Invalid GitHub release");
  const manifestAsset = assetOf(release, MANIFEST);
  const signatureAsset = assetOf(release, SIGNATURE);
  const [manifestResponse, signatureResponse] = await Promise.all([
    getResponse(manifestAsset.browser_download_url, { fetchImpl, signal }),
    getResponse(signatureAsset.browser_download_url, { fetchImpl, signal })
  ]);
  const [manifestText, signatureText] = await Promise.all([
    readBounded(manifestResponse, 8192), readBounded(signatureResponse, 256)
  ]);
  const verified = verifySignedRelease({
    manifestBytes: Buffer.from(manifestText),
    signatureBytes: Buffer.from(signatureText),
    publicKeyPem,
    trustedPublicKeySpkiSha256
  });
  if (verified.tag !== release.tag_name) throw new Error("Signed release tag differs from published tag");
  const zip = assetOf(release, "AkariyaTenka.zip");
  assetOf(release, "AkariyaTenka.zip.sha256");
  if (Number.isSafeInteger(zip.size) && zip.size !== verified.size) {
    throw new Error("Signed release size differs from advertised ZIP");
  }
  return verified;
}

// Downloads and stages only after cryptographic publisher validation.
// Installation still occurs exclusively under launcher supervision on restart.
export async function downloadAndPrepareSignedUpdate({
  root, updatesDir, publicKeyPem, trustedPublicKeySpkiSha256,
  fetchImpl = fetch, signal, onProgress
}) {
  const signed = await discoverSignedUpdate({ publicKeyPem, trustedPublicKeySpkiSha256, fetchImpl, signal });
  const downloaded = await downloadVerifiedRelease({
    release: { tag: signed.tag }, updatesDir, fetchImpl, signal, onProgress
  });
  assertMatchingDownloadedRelease(signed, downloaded);
  const archive = await readFile(downloaded.file);
  if (archive.length !== signed.size ||
      createHash("sha256").update(archive).digest("hex") !== signed.sha256) {
    throw new Error("Downloaded ZIP changed after verification");
  }
  return prepareTrustedRelease({
    root, archivePath: downloaded.file,
    trustedSha256: signed.sha256, sourceSha: signed.sourceSha
  });
}
