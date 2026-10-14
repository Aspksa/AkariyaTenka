import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { provisionPublisherKey } from "./provision-publisher-key.mjs";
import { verifyPublisherKeypair } from "./verify-publisher-keypair.mjs";

test("verify publisher keypair and reject wrong fingerprint", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "akariya-publisher-verify-"));
  const folder = path.join(parent, "keypair");
  try {
    const generated = await provisionPublisherKey({outputDir: folder});
    const checked = await verifyPublisherKeypair(folder);
    assert.equal(checked.valid, true);
    assert.equal(checked.fingerprint, generated.fingerprint);
    await writeFile(path.join(folder, "publisher-spki-sha256.txt"), "0".repeat(64) + "\n");
    await assert.rejects(verifyPublisherKeypair(folder), /fingerprint mismatch/);
  } finally {
    await rm(parent, {recursive:true, force:true});
  }
});

test("verify publisher keypair fails closed if private PEM is damaged", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "akariya-publisher-tamper-"));
  const folder = path.join(parent, "keypair");
  try {
    await provisionPublisherKey({outputDir:folder});
    await writeFile(path.join(folder,"publisher-private.pem"), "not a private key");
    await assert.rejects(verifyPublisherKeypair(folder));
  } finally {
    await rm(parent, {recursive:true,force:true});
  }
});
