import { createHash, createPublicKey, verify } from "node:crypto";

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const MAX_DOCUMENT_BYTES = 8192;

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === expected.slice().sort().join("|");
}

export function canonicalReleasePayload(manifest) {
  if (!exactKeys(manifest, ["schemaVersion", "repository", "tag", "sourceSha", "archiveSha256", "archiveSize"]) ||
      manifest.schemaVersion !== 1 || manifest.repository !== "Aspksa/AkariyaTenka" ||
      typeof manifest.tag !== "string" || !TAG.test(manifest.tag) ||
      typeof manifest.sourceSha !== "string" || !HEX40.test(manifest.sourceSha) ||
      typeof manifest.archiveSha256 !== "string" || !HEX64.test(manifest.archiveSha256) ||
      !Number.isSafeInteger(manifest.archiveSize) || manifest.archiveSize <= 0 ||
      manifest.archiveSize > 256 * 1024 * 1024) {
    throw new Error("Invalid signed release metadata");
  }
  return Buffer.from([
    "akariya-release-v1",
    manifest.repository,
    manifest.tag,
    manifest.sourceSha,
    manifest.archiveSha256,
    String(manifest.archiveSize),
    ""
  ].join("\n"), "utf8");
}

// trustedPublicKeySpkiSha256 is pinned at build/distribution time, not downloaded with the release.
// Public keys from a release asset MUST NOT be accepted as independent trust.
export function verifySignedRelease({ manifestBytes, signatureBytes, publicKeyPem, trustedPublicKeySpkiSha256 }) {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length > MAX_DOCUMENT_BYTES ||
      !Buffer.isBuffer(signatureBytes) || signatureBytes.length > 256 ||
      typeof publicKeyPem !== "string" || typeof trustedPublicKeySpkiSha256 !== "string" ||
      !HEX64.test(trustedPublicKeySpkiSha256)) throw new Error("Invalid release verification input");
  let key;
  try { key = createPublicKey(publicKeyPem); }
  catch { throw new Error("Invalid publisher public key"); }
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Publisher key must be Ed25519");
  const spki = key.export({ format: "der", type: "spki" });
  if (createHash("sha256").update(spki).digest("hex") !== trustedPublicKeySpkiSha256) {
    throw new Error("Publisher key is not pinned");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch { throw new Error("Malformed signed release manifest"); }
  const message = canonicalReleasePayload(manifest);
  const encoded = signatureBytes.toString("utf8").trim();
  if (!BASE64.test(encoded)) throw new Error("Invalid release signature encoding");
  const signature = Buffer.from(encoded, "base64");
  if (signature.length !== 64 || !verify(null, message, key, signature)) {
    throw new Error("Release signature verification failed");
  }
  return Object.freeze({
    tag: manifest.tag, sourceSha: manifest.sourceSha,
    sha256: manifest.archiveSha256, size: manifest.archiveSize,
    keyFingerprint: trustedPublicKeySpkiSha256
  });
}

export function assertMatchingDownloadedRelease(verified, downloaded) {
  if (!verified || !downloaded || verified.tag !== downloaded.tag ||
      verified.sha256 !== downloaded.sha256 ||
      !Number.isSafeInteger(downloaded.bytes) || verified.size !== downloaded.bytes) {
    throw new Error("Downloaded release differs from signed metadata");
  }
  return true;
}
