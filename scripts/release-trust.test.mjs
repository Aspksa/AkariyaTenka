import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalReleasePayload, verifySignedRelease, assertMatchingDownloadedRelease } from "./release-trust.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
const trustedPublicKeySpkiSha256 = createHash("sha256")
  .update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
const manifest = {
  schemaVersion: 1,
  repository: "Aspksa/AkariyaTenka",
  tag: "v1.2.3",
  sourceSha: "a".repeat(40),
  archiveSha256: "b".repeat(64),
  archiveSize: 1234
};
function signed(value) {
  return {
    manifestBytes: Buffer.from(JSON.stringify(value)),
    signatureBytes: Buffer.from(sign(null, canonicalReleasePayload(value), privateKey).toString("base64") + "\n"),
    publicKeyPem, trustedPublicKeySpkiSha256
  };
}
test("accepts independently pinned publisher signature and matching download", () => {
  const result = verifySignedRelease(signed(manifest));
  assert.equal(result.sourceSha, manifest.sourceSha);
  assert.equal(assertMatchingDownloadedRelease(result, {tag: "v1.2.3", sha256: manifest.archiveSha256, bytes: 1234}), true);
  assert.throws(() => assertMatchingDownloadedRelease(result, {tag: "v1.2.3", sha256: manifest.archiveSha256, bytes: 1235}), /differs/);
});
test("rejects unsigned modifications and unpinned key", () => {
  const good = signed(manifest);
  const tampered = { ...good, manifestBytes: Buffer.from(JSON.stringify({...manifest, archiveSize: 9})) };
  assert.throws(() => verifySignedRelease(tampered), /verification failed/);
  assert.throws(() => verifySignedRelease({...good, trustedPublicKeySpkiSha256: "0".repeat(64)}), /not pinned/);
});
test("rejects unsupported schema, keys and malformed signed inputs", () => {
  assert.throws(() => canonicalReleasePayload({...manifest, extra: "ignored"}), /Invalid/);
  assert.throws(() => canonicalReleasePayload({...manifest, tag: "v1.2.3-rc1"}), /Invalid/);
  assert.throws(() => canonicalReleasePayload({...manifest, repository: "attacker/fork"}), /Invalid/);
  assert.throws(() => verifySignedRelease({...signed(manifest), signatureBytes: Buffer.from("not a signature")}), /encoding/);
});
