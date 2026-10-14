import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializePortableIdentity } from "./portable-identity.mjs";
import { transferPortableCopy } from "./portable-transfer.mjs";
import { createPortableSnapshot, comparePortableAncestry } from "./portable-state.mjs";

test("immutable baselines distinguish independent edits without merging", async () => {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-state-"));
 const a=path.join(base,"ssd"),b=path.join(base,"local");
 try {
  await mkdir(a);
  await initializePortableIdentity(a);
  await writeFile(path.join(a,"memory.txt"),"base");
  await writeFile(path.join(a,"settings.txt"),"base");
  await transferPortableCopy(a,b);
  await createPortableSnapshot(a);
  await createPortableSnapshot(b);
  const initial=await comparePortableAncestry(a,b);
  assert.equal(initial.status,"shared-baseline");
  assert.deepEqual(initial.conflicts,[]);
  await writeFile(path.join(a,"memory.txt"),"ssd update");
  await writeFile(path.join(b,"memory.txt"),"desktop update");
  await writeFile(path.join(b,"settings.txt"),"desktop settings");
  const current=await comparePortableAncestry(a,b);
  assert.deepEqual(current.changedLeft,["memory.txt"]);
  assert.deepEqual(current.changedRight,["memory.txt","settings.txt"]);
  assert.deepEqual(current.conflicts,["memory.txt"]);
  await assert.rejects(createPortableSnapshot(a),/EEXIST/);
 } finally { await rm(base,{recursive:true,force:true}); }
});
test("requires identity and rejects missing baseline", async () => {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-state-missing-"));
 try {
  await assert.rejects(createPortableSnapshot(base),/identity required/);
  await initializePortableIdentity(base);
  assert.equal((await comparePortableAncestry(base,base)).status,"unavailable");
 } finally {await rm(base,{recursive:true,force:true});}
});
