import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { provisionPublisherKey } from "./provision-publisher-key.mjs";

test("publisher key provision produces persistent valid Ed25519 keypair outside checkout", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "akariya-publisher-test-"));
  const destination = path.join(home, "private");
  try {
    const generated = await provisionPublisherKey({ outputDir: destination });
    assert.match(generated.fingerprint, /^[a-f0-9]{64}$/);
    const privateKey = createPrivateKey(await readFile(path.join(destination, "publisher-private.pem"), "utf8"));
    const publicKey = createPublicKey(await readFile(path.join(destination, "publisher-public.pem"), "utf8"));
    assert.equal(privateKey.asymmetricKeyType, "ed25519");
    assert.equal(publicKey.asymmetricKeyType, "ed25519");
    const actual = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    assert.equal(actual, generated.fingerprint);
    const payload = Buffer.from("test artifact");
    assert.equal(verify(null, payload, publicKey, sign(null, payload, privateKey)), true);
    await assert.rejects(provisionPublisherKey({ outputDir: destination }), /EEXIST/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("refuses key output inside repository checkout", async () => {
  await assert.rejects(provisionPublisherKey({ outputDir: path.resolve(".keys-must-not-exist") }), /checkout/);
  await assert.rejects(provisionPublisherKey({ outputDir: "relative" }), /absolute/);
});
