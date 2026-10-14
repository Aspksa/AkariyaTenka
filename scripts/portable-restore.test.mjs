import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {initializePortableIdentity} from "./portable-identity.mjs";
import {backupPortableState} from "./portable-backup.mjs";
import {restorePortableBackup} from "./portable-restore.mjs";

test("restores a verified backup into a new separate directory only",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-restore-"));
 const root=path.join(base,"source"),destination=path.join(base,"recovered");
 try {
  await mkdir(path.join(root,"data"),{recursive:true});
  await initializePortableIdentity(root);
  await writeFile(path.join(root,"data","memory.txt"),"before");
  const {backupId}=await backupPortableState(root,{acknowledgeStopped:true});
  await writeFile(path.join(root,"data","memory.txt"),"after");
  await assert.rejects(restorePortableBackup(root,backupId,destination),/stopped/);
  const result=await restorePortableBackup(root,backupId,destination,{acknowledgeStopped:true});
  assert.equal(result.restored,true);
  assert.equal(await readFile(path.join(destination,"data","memory.txt"),"utf8"),"before");
  assert.equal(await readFile(path.join(root,"data","memory.txt"),"utf8"),"after");
  await assert.rejects(restorePortableBackup(root,backupId,destination,{acknowledgeStopped:true}),/already exists/);
  await assert.rejects(restorePortableBackup(root,backupId,path.join(root,"restore"),{acknowledgeStopped:true}),/overlap/);
 } finally {await rm(base,{recursive:true,force:true});}
});
test("corrupted backup never creates destination",async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-restore-corrupt-"));
 const root=path.join(base,"source"),destination=path.join(base,"dest");
 try {
  await mkdir(root);await initializePortableIdentity(root);await writeFile(path.join(root,"file.txt"),"ok");
  const {backupId}=await backupPortableState(root,{acknowledgeStopped:true});
  await writeFile(path.join(root,".portable-state","backups",backupId,"files","file.txt"),"bad");
  await assert.rejects(restorePortableBackup(root,backupId,destination,{acknowledgeStopped:true}),/checksum mismatch/);
  await assert.rejects(readFile(path.join(destination,"file.txt")) ,/ENOENT/);
 } finally {await rm(base,{recursive:true,force:true});}
});
