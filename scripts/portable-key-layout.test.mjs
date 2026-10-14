import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transferPortableCopy, snapshotPortableFiles } from "./portable-transfer.mjs";

test("portable transfer includes trusted public key but excludes private project vault", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "akariya-key-layout-"));
  const src = path.join(parent, "source"), dst = path.join(parent, "copy");
  try {
    await mkdir(path.join(src, "keys", "public"), { recursive: true });
    await mkdir(path.join(src, "keys", "private"), { recursive: true });
    await writeFile(path.join(src, "keys", "public", "publisher-public.pem"), "example public key");
    await writeFile(path.join(src, "keys", "private", "vault.enc"), "encrypted local secret");
    const files = await snapshotPortableFiles(src);
    assert.equal(Object.hasOwn(files, "keys/public/publisher-public.pem"), true);
    assert.equal(Object.hasOwn(files, "keys/private/vault.enc"), false);
    await transferPortableCopy(src, dst);
    assert.equal(await readFile(path.join(dst, "keys", "public", "publisher-public.pem"), "utf8"), "example public key");
    await assert.rejects(readFile(path.join(dst, "keys", "private", "vault.enc")), /ENOENT/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("raw signing key in regular directory fails closed", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "akariya-raw-key-"));
  try {
    await writeFile(path.join(parent, "publisher-private.pem"), "unsafe");
    await assert.rejects(snapshotPortableFiles(parent), /Publisher private/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
