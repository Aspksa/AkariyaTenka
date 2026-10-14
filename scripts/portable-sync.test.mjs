import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planPortableSync, syncPortableAdditions } from "./portable-sync.mjs";

test("plans and copies additions without overwriting destination", async () => {
 const base = await mkdtemp(path.join(os.tmpdir(), "akariya-sync-"));
 const source = path.join(base,"source"), destination = path.join(base,"destination");
 try {
  await mkdir(source); await mkdir(destination);
  await writeFile(path.join(source,"shared.txt"),"same");
  await writeFile(path.join(destination,"shared.txt"),"same");
  await mkdir(path.join(source,"data"));
  await writeFile(path.join(source,"data","extra.txt"),"memory");
  const plan = await planPortableSync(source,destination);
  assert.deepEqual(plan.additions,["data/extra.txt"]);
  assert.deepEqual(plan.conflicts,[]);
  await assert.rejects(syncPortableAdditions(source,destination),/confirmation/);
  assert.deepEqual(await syncPortableAdditions(source,destination,{acknowledgeStopped:true}),{added:1,verified:true,conflicts:[]});
  assert.equal(await readFile(path.join(destination,"data","extra.txt"),"utf8"),"memory");
  assert.equal((await planPortableSync(source,destination)).additions.length,0);
 } finally { await rm(base,{recursive:true,force:true}); }
});
test("conflicting files prevent additions and preserve both copies", async () => {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-sync-conflict-"));
 const from=path.join(base,"a"), to=path.join(base,"b");
 try {
  await mkdir(from); await mkdir(to);
  await writeFile(path.join(from,"state.db"),"new");
  await writeFile(path.join(to,"state.db"),"old");
  await writeFile(path.join(from,"missing.txt"),"add");
  const plan=await planPortableSync(from,to);
  assert.deepEqual(plan.conflicts,["state.db"]);
  await assert.rejects(syncPortableAdditions(from,to,{acknowledgeStopped:true}),/Conflicting/);
  assert.equal(await readFile(path.join(to,"state.db"),"utf8"),"old");
  await assert.rejects(readFile(path.join(to,"missing.txt")),/ENOENT/);
 } finally { await rm(base,{recursive:true,force:true}); }
});
