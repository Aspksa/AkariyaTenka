import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializePortableIdentity } from "./portable-identity.mjs";
import { queuePortableAction, performQueuedPortableAction, readPortableActionResult, validatePortableAction } from "./portable-supervised.mjs";
import { acquirePortableRuntime } from "./portable-runtime-lock.mjs";

const token = "portable-supervisor-unit-test-key-must-be-secret-123";
test("supervised transfer only starts after runtime lock release and copies new installation", async () => {
  const base=await mkdtemp(path.join(os.tmpdir(),"akariya-supervised-"));
  const root=path.join(base,"running"),dest=path.join(base,"recovered");
  try {
    await mkdir(root);
    await initializePortableIdentity(root);
    await writeFile(path.join(root,"memo.txt"),"portable memory");
    const release=await acquirePortableRuntime(root);
    await queuePortableAction(root,{action:"copy",other:dest,confirm:"ПЕРЕНЕСТИ"},token);
    await release();
    const result=await performQueuedPortableAction(root,token);
    assert.equal(result.status,"success");
    assert.equal(await readFile(path.join(dest,"memo.txt"),"utf8"),"portable memory");
    assert.equal((await readPortableActionResult(root)).status,"success");
    await assert.rejects(performQueuedPortableAction(root,token),/ENOENT/);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("supervised action fails closed when runtime still owns source", async () => {
  const base=await mkdtemp(path.join(os.tmpdir(),"akariya-supervised-lock-"));
  const root=path.join(base,"running"),dest=path.join(base,"copy");
  try {
    await mkdir(root);
    await initializePortableIdentity(root);
    const release=await acquirePortableRuntime(root);
    await queuePortableAction(root,{action:"copy",other:dest,confirm:"ПЕРЕНЕСТИ"},token);
    const result=await performQueuedPortableAction(root,token);
    assert.equal(result.status,"failed");
    await assert.rejects(readFile(path.join(dest,".akariya-installation.json")),/ENOENT/);
    await release();
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("different launcher token cannot consume stale request", async () => {
  const base=await mkdtemp(path.join(os.tmpdir(),"akariya-supervised-token-"));
  const root=path.join(base,"a"), dest=path.join(base,"b");
  try {
    await mkdir(root);
    await queuePortableAction(root,{action:"copy",other:dest,confirm:"ПЕРЕНЕСТИ"},token);
    const result=await performQueuedPortableAction(root,"different-supervisor-session-token-456");
    assert.equal(result.status,"failed");
    await assert.rejects(readFile(path.join(dest,"memo.txt")),/ENOENT/);
    assert.match(result.error,/current supervised launch/);
  } finally { await rm(base,{recursive:true,force:true}); }
});

test("transfer request validation refuses malformed paths, overlap and missing confirmation", () => {
 const base=path.resolve("local-project");
 assert.throws(()=>validatePortableAction(base,{action:"copy",other:"relative",confirm:"ПЕРЕНЕСТИ"}),/Invalid/);
 assert.throws(()=>validatePortableAction(base,{action:"copy",other:base,confirm:"ПЕРЕНЕСТИ"}),/overlap/);
 assert.throws(()=>validatePortableAction(base,{action:"restore",other:path.resolve("separate"),confirm:"ПЕРЕНЕСТИ"}),/backup/);
 assert.throws(()=>validatePortableAction(base,{action:"copy",other:path.resolve("separate"),confirm:"NO"}),/Invalid/);
});
