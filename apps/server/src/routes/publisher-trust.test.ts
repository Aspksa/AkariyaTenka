import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { loadPublisherTrust } from "./publisher-trust.js";

test("missing publisher key fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-trust-"));
  try { assert.equal(await loadPublisherTrust(root), null); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("accepts explicit Ed25519 public key with matching fingerprint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-trust-"));
  try {
    const folder = path.join(root, "keys", "public");
    await mkdir(folder, { recursive: true });
    const { publicKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    await writeFile(path.join(folder, "publisher-public.pem"), pem);
    await writeFile(path.join(folder, "publisher-spki-sha256.txt"), fingerprint + "\n");
    assert.equal((await loadPublisherTrust(root))?.spkiSha256, fingerprint);
    await writeFile(path.join(folder, "publisher-spki-sha256.txt"), "0".repeat(64));
    if (fingerprint !== "0".repeat(64)) await assert.rejects(loadPublisherTrust(root), /does not match/);
    await rm(path.join(folder, "publisher-spki-sha256.txt"));
    await assert.rejects(loadPublisherTrust(root), /Incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
