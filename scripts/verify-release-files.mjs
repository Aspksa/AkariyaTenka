import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifySignedRelease } from "./release-trust.mjs";

export async function verifyReleaseFiles({ manifestPath, signaturePath, archivePath, publicKeyPem, trustedPublicKeySpkiSha256 }) {
  const [manifestBytes, signatureBytes, archive] = await Promise.all([
    readFile(manifestPath), readFile(signaturePath), readFile(archivePath)
  ]);
  const identity = verifySignedRelease({ manifestBytes, signatureBytes, publicKeyPem, trustedPublicKeySpkiSha256 });
  if (archive.length !== identity.size ||
      createHash("sha256").update(archive).digest("hex") !== identity.sha256) {
    throw new Error("Signed release archive mismatch");
  }
  return identity;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [manifestPath, signaturePath, archivePath] = process.argv.slice(2);
  if (!manifestPath || !signaturePath || !archivePath) {
    console.error("Usage: node scripts/verify-release-files.mjs MANIFEST SIGNATURE ARCHIVE");
    process.exitCode = 2;
  } else {
    verifyReleaseFiles({manifestPath, signaturePath, archivePath,
      publicKeyPem: process.env.AKARIYA_RELEASE_PUBLIC_KEY_PEM,
      trustedPublicKeySpkiSha256: process.env.AKARIYA_RELEASE_PUBLIC_KEY_FINGERPRINT
    }).then(() => console.log("Signed release verified")).catch(e => {console.error(e.message); process.exitCode = 1;});
  }
}
