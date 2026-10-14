import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run locally by the publisher. No private key contents are printed or transmitted.
export async function verifyPublisherKeypair(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Absolute key directory required");
  const [privatePem, publicPem, fingerprintFile] = await Promise.all([
    readFile(path.join(directory, "publisher-private.pem"), "utf8"),
    readFile(path.join(directory, "publisher-public.pem"), "utf8"),
    readFile(path.join(directory, "publisher-spki-sha256.txt"), "utf8")
  ]);
  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(publicPem);
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Expected Ed25519 publisher keys");
  }
  const fingerprint = createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
  if (!/^[a-f0-9]{64}\n?$/.test(fingerprintFile) || fingerprintFile.trim() !== fingerprint) {
    throw new Error("Publisher public key fingerprint mismatch");
  }
  const message = Buffer.from("akariya-publisher-keypair-v1\n");
  if (!verify(null, message, publicKey, sign(null, message, privateKey))) {
    throw new Error("Private and public keys do not match");
  }
  return Object.freeze({ fingerprint, valid: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  verifyPublisherKeypair(process.argv[2])
    .then(({fingerprint}) => console.log("Publisher keypair verified; SPKI SHA-256: " + fingerprint))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
