import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withPortableSyncLocks } from "./portable-sync-lock.mjs";

test("cooperative locks exclude concurrent work and release after success",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-lock-"));
 const a=path.join(base,"a"),b=path.join(base,"b");
 try {
  await mkdir(a);await mkdir(b);
  await withPortableSyncLocks([a,b],async()=>{
   await assert.rejects(withPortableSyncLocks([b,a],async()=>{}),/already locked/);
  });
  const result=await withPortableSyncLocks([b,a],async()=>42);
  assert.equal(result,42);
 } finally {await rm(base,{recursive:true,force:true});}
});
test("locks release on task failure and reject duplicate roots",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-lock-fail-"));
 try {
  await assert.rejects(withPortableSyncLocks([base,base],async()=>{}),/duplicate/);
  await assert.rejects(withPortableSyncLocks([base],async()=>{throw Error("intentional");}),/intentional/);
  await withPortableSyncLocks([base],async()=>{});
 } finally {await rm(base,{recursive:true,force:true});}
});
