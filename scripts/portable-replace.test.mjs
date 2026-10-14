import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {initializePortableIdentity} from "./portable-identity.mjs";
import {transferPortableCopy} from "./portable-transfer.mjs";
import {createPortableSnapshot} from "./portable-state.mjs";
import {planPortableReplacement,applyPortableReplacement} from "./portable-replace.mjs";
import {acquirePortableRuntime} from "./portable-runtime-lock.mjs";
test("changed file moves to SSD and backup preserves prior content",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-p0-"));
 const s=path.join(base,"ssd"),p=path.join(base,"pc");
 try{
  await mkdir(s);await initializePortableIdentity(s);
  await writeFile(path.join(s,"memory.json"),"old");
  await transferPortableCopy(s,p);
  await createPortableSnapshot(s);await createPortableSnapshot(p);
  await writeFile(path.join(p,"memory.json"),"new");
  assert.deepEqual((await planPortableReplacement(p,s)).replace,["memory.json"]);
  const r=await applyPortableReplacement(p,s,{acknowledgeStopped:true});
  assert.equal(r.verified,true);
  assert.equal(await readFile(path.join(s,"memory.json"),"utf8"),"new");
  assert.equal(await readFile(path.join(s,".portable-state","backups",r.backupId,"files","memory.json"),"utf8"),"old");
 } finally{await rm(base,{recursive:true,force:true});}
});
test("diverged files and active runtime refuse transfer",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-p0-conflict-"));
 const a=path.join(base,"a"),b=path.join(base,"b");
 try{
  await mkdir(a);await initializePortableIdentity(a);await writeFile(path.join(a,"data.db"),"original");
  await transferPortableCopy(a,b);await createPortableSnapshot(a);await createPortableSnapshot(b);
  const release=await acquirePortableRuntime(a);
  await assert.rejects(applyPortableReplacement(b,a,{acknowledgeStopped:true}),/Running Akariya/);
  await release();
  await writeFile(path.join(a,"data.db"),"home");
  await writeFile(path.join(b,"data.db"),"work");
  assert.deepEqual((await planPortableReplacement(b,a)).conflicts,["data.db"]);
  await assert.rejects(applyPortableReplacement(b,a,{acknowledgeStopped:true}),/Divergence/);
  assert.equal(await readFile(path.join(a,"data.db"),"utf8"),"home");
 }finally{await rm(base,{recursive:true,force:true});}
});
