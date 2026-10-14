import { createHash, createPublicKey } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { PublisherTrust } from "./update-verify.js";

const SHA256 = /^[a-f0-9]{64}$/;

export async function loadPublisherTrust(root: string): Promise<PublisherTrust | null> {
  const directory = path.join(path.resolve(root), "keys", "public");
  const pemPath = path.join(directory, "publisher-public.pem");
  const fingerprintPath = path.join(directory, "publisher-spki-sha256.txt");

  const files = await Promise.all([pemPath, fingerprintPath].map(async (filename) => {
    try {
      const metadata = await lstat(filename);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Publisher trust file must be a regular file");
      return await readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  if (files.every((value) => value === null)) return null;
  if (files.some((value) => value === null)) throw new Error("Incomplete publisher trust configuration");

  const publicKeyPem = files[0]!;
  const spkiSha256 = files[1]!.trim();
  if (!SHA256.test(spkiSha256) || publicKeyPem.length > 8192) throw new Error("Invalid publisher trust configuration");
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Publisher key must be Ed25519");
  const actual = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  if (actual !== spkiSha256) throw new Error("Publisher fingerprint does not match public key");
  return { publicKeyPem, spkiSha256 };
}
