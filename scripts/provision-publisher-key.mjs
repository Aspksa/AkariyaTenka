import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run on the publisher's trusted computer, never in CI or a chat session.
// Explicit output directory must be outside the checkout.
export async function provisionPublisherKey({ outputDir, repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url))) }) {
  if (typeof outputDir !== "string" || !path.isAbsolute(outputDir)) {
    throw new Error("Specify an absolute destination directory outside the repository");
  }
  const root = await realpath(repositoryRoot);
  const destination = path.resolve(outputDir);
  const parent = await realpath(path.dirname(destination));
  const resolvedDestination = path.join(parent, path.basename(destination));
  const relative = path.relative(root, resolvedDestination);
  if (relative === "" || (!relative.startsWith(".."+path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Publisher keys must never be written into the checkout");
  }
  await mkdir(resolvedDestination, { recursive: false, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const fingerprint = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
  try {
    await writeFile(path.join(resolvedDestination, "publisher-private.pem"), privatePem, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(resolvedDestination, "publisher-public.pem"), publicPem, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(resolvedDestination, "publisher-spki-sha256.txt"), fingerprint + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(resolvedDestination, { recursive: true, force: true });
    throw error;
  }
  return { fingerprint, directory: resolvedDestination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  provisionPublisherKey({ outputDir: process.argv[2] })
    .then(({ fingerprint, directory }) => {
      console.log("Publisher keys created in private directory: " + directory);
      console.log("Public SPKI fingerprint: " + fingerprint);
      console.log("Never publish publisher-private.pem or paste it into a chat.");
    })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
