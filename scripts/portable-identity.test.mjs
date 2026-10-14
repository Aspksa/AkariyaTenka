import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializePortableIdentity, readPortableIdentity, assertSamePortableInstallation } from "./portable-identity.mjs";
import { transferPortableCopy } from "./portable-transfer.mjs";
import { planPortableSync } from "./portable-sync.mjs";
test("identity survives portable copy and allows sync", async () => {
 const tmp=await mkdtemp(path.join(os.tmpdir(),"akariya-identity-"));
 const a=path.join(tmp,"a"),b=path.join(tmp,"b");
 try {
  await mkdir(a);
  const id=await initializePortableIdentity(a);
  await assert.rejects(initializePortableIdentity(a),/EEXIST/);
  await transferPortableCopy(a,b);
  assert.equal(await readPortableIdentity(b),id);
  assert.deepEqual(await assertSamePortableInstallation(a,b),{legacy:false,installationId:id});
  assert.equal((await planPortableSync(a,b)).safeToAdd,true);
 } finally {await rm(tmp,{recursive:true,force:true});}
});
test("sync rejects copies with different identities or missing one", async () => {
 const tmp=await mkdtemp(path.join(os.tmpdir(),"akariya-identity-mismatch-"));
 const a=path.join(tmp,"a"),b=path.join(tmp,"b");
 try {
  await mkdir(a);await mkdir(b);
  await initializePortableIdentity(a);
  await assert.rejects(planPortableSync(a,b),/identity differs/);
  await initializePortableIdentity(b);
  await assert.rejects(planPortableSync(a,b),/identity differs/);
 } finally {await rm(tmp,{recursive:true,force:true});}
});
