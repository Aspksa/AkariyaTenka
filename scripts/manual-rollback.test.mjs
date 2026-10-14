import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyManualRollback, pendingGithubUpdate, recoverInterruptedUpdate } from "./github-update.mjs";

const OLD="a".repeat(40), NEW="b".repeat(40);
test("manual rollback restores code but never changes data or env", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-manual-rollback-"));
  try {
    const id="11111111-1111-4111-8111-111111111111";
    const backup=path.join(root,".runtime","github-updater","backups",id);
    await mkdir(backup,{recursive:true});
    for(const name of ["scripts","apps","packages"]){
      await mkdir(path.join(root,name));
      await mkdir(path.join(backup,name));
      await writeFile(path.join(root,name,"sample.txt"),"new");
      await writeFile(path.join(backup,name,"sample.txt"),"old");
    }
    for(const name of ["package.json","package-lock.json","AKARIYA.bat"]){
      await writeFile(path.join(root,name),"new");
      await writeFile(path.join(backup,name),"old");
    }
    await mkdir(path.join(root,"data"));
    await writeFile(path.join(root,"data","private.json"),"keep");
    await writeFile(path.join(root,".env"),"secret=keep");
    await writeFile(path.join(root,".akariya-version"),NEW+"\n");
    await writeFile(path.join(backup,".akariya-version"),OLD+"\n");
    await writeFile(path.join(backup,".akariya-backup.json"),JSON.stringify({kind:"akariya-github-backup",schemaVersion:1}));
    assert.equal(await applyManualRollback(id,root),OLD);
    assert.equal(await pendingGithubUpdate(root),OLD);
    assert.equal(await readFile(path.join(root,"scripts","sample.txt"),"utf8"),"old");
    assert.equal(await readFile(path.join(root,"data","private.json"),"utf8"),"keep");
    assert.equal(await readFile(path.join(root,".env"),"utf8"),"secret=keep");
    // Simulate failed startup after manual rollback; current code must return.
    await recoverInterruptedUpdate(root);
    assert.equal(await readFile(path.join(root,"scripts","sample.txt"),"utf8"),"new");
    assert.equal(await readFile(path.join(root,".akariya-version"),"utf8"),NEW+"\n");
  } finally {await rm(root,{recursive:true,force:true});}
});
