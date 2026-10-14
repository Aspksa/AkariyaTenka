import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inspectPortableCopy, transferPortableCopy } from "./portable-transfer.mjs";

test("copy preserves data and detects conflicts without overwriting", async () => {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-portable-"));
 const source=path.join(base,"source"), target=path.join(base,"target");
 try {
  await mkdir(path.join(source,"data"),{recursive:true});
  await writeFile(path.join(source,"data","memory.txt"),"remember this");
  await writeFile(path.join(source,"AKARIYA.bat"),"@echo off");
  const result=await transferPortableCopy(source,target);
  assert.equal(result.verified,true);
  assert.equal(await readFile(path.join(target,"data","memory.txt"),"utf8"),"remember this");
  assert.equal((await inspectPortableCopy(source,target)).identical,true);
  await writeFile(path.join(target,"data","memory.txt"),"changed on computer");
  assert.deepEqual((await inspectPortableCopy(source,target)).changed,["data/memory.txt"]);
  await assert.rejects(transferPortableCopy(source,target),/already exists/);
  assert.equal(await readFile(path.join(target,"data","memory.txt"),"utf8"),"changed on computer");
 } finally { await rm(base,{recursive:true,force:true}); }
});
test("refuses nested transfer and publisher private key", async () => {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-portable-safe-"));
 try {
  await writeFile(path.join(base,"publisher-private.pem"),"forbidden");
  await assert.rejects(transferPortableCopy(base,path.join(os.tmpdir(),"unused-akariya-private-test")),/Publisher private/);
  await assert.rejects(transferPortableCopy(base,path.join(base,"nested")),/overlap/);
 } finally { await rm(base,{recursive:true,force:true}); }
});
