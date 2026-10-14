import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializePortableIdentity } from "./portable-identity.mjs";
import { backupPortableState, verifyPortableBackup } from "./portable-backup.mjs";

test("portable backup is non-destructive, verified and kept separately", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"akariya-backup-"));
 try {
  await initializePortableIdentity(root);
  await mkdir(path.join(root,"data"));
  await writeFile(path.join(root,"data","memory.txt"),"state-1");
  await assert.rejects(backupPortableState(root),/stopped/);
  const result=await backupPortableState(root,{acknowledgeStopped:true});
  assert.equal(result.verified,true);
  assert.equal((await verifyPortableBackup(root,result.backupId)).verified,true);
  await writeFile(path.join(root,"data","memory.txt"),"state-2");
  assert.equal(await readFile(path.join(root,"data","memory.txt"),"utf8"),"state-2");
  assert.equal(await readFile(path.join(root,".portable-state","backups",result.backupId,"files","data","memory.txt"),"utf8"),"state-1");
  await writeFile(path.join(root,".portable-state","backups",result.backupId,"files","data","memory.txt"),"damaged");
  await assert.rejects(verifyPortableBackup(root,result.backupId),/checksum mismatch/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test("backup rejects identity absence",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"akariya-backup-noid-"));
 try { await assert.rejects(backupPortableState(root,{acknowledgeStopped:true}),/identity/); }
 finally { await rm(root,{recursive:true,force:true}); }
});
