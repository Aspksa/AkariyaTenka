import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { acquirePortableRuntime } from "./portable-runtime-lock.mjs";

async function fixture(fn) {
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-runtime-lock-"));
  try { await fn(root); } finally { await rm(root,{recursive:true,force:true}); }
}
test("blocks a second live instance and releases own lock", async () => fixture(async root => {
  const release=await acquirePortableRuntime(root);
  try { await assert.rejects(acquirePortableRuntime(root),/already running/); }
  finally { await release(); }
  const again=await acquirePortableRuntime(root);
  await again();
}));
test("archives a valid dead-owner lock and recovers", async () => fixture(async root => {
  const dir=path.join(root,".portable-state"),lock=path.join(dir,"runtime.lock");
  await mkdir(lock,{recursive:true});
  // PID deliberately outside the operating system's supported process range.
  await writeFile(path.join(lock,"owner.json"), JSON.stringify({nonce:"12345678-1234-1234-1234-123456789abc",pid:2147483647})+"\n");
  const release=await acquirePortableRuntime(root);
  try {
    assert.ok((await readdir(dir)).some(name=>name.startsWith("runtime.lock.stale-")));
  } finally {await release();}
}));
test("does not overwrite missing or corrupt lock metadata", async () => fixture(async root => {
  const lock=path.join(root,".portable-state","runtime.lock");
  await mkdir(lock,{recursive:true});
  await assert.rejects(acquirePortableRuntime(root),/manual inspection/);
  await writeFile(path.join(lock,"owner.json"),"{broken");
  await assert.rejects(acquirePortableRuntime(root),/manual inspection/);
}));
test("does not recover while sync lock exists", async () => fixture(async root => {
  const dir=path.join(root,".portable-state");
  await mkdir(path.join(dir,"sync.lock"),{recursive:true});
  await assert.rejects(acquirePortableRuntime(root),/synchronization active/);
}));
