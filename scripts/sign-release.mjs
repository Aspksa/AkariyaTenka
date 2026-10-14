import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { canonicalReleasePayload } from "./release-trust.mjs";

// Explicit release-publishing utility. Keep signing keys outside the source tree.
// No fallback keys, generated ephemeral publisher keys, or unsigned downgrade.
export async function signReleaseManifest({ manifestPath, signaturePath, privateKeyPem }) {
  if (typeof privateKeyPem !== "string" || !privateKeyPem.trim()) throw new Error("Publisher signing key required");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Publisher signing key must be Ed25519");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const signature = sign(null, canonicalReleasePayload(manifest), privateKey);
  await writeFile(signaturePath, signature.toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  return signaturePath;
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const [manifestPath, signaturePath] = process.argv.slice(2);
  if (!manifestPath || !signaturePath) {
    console.error("Usage: node scripts/sign-release.mjs manifest.json signature.sig");
    process.exitCode = 2;
  } else {
    signReleaseManifest({ manifestPath, signaturePath, privateKeyPem: process.env.AKARIYA_RELEASE_SIGNING_KEY_PEM })
      .catch((e) => { console.error(e.message); process.exitCode = 1; });
  }
}
