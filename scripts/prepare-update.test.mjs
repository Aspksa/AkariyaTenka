import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectReleaseZip, prepareTrustedRelease } from "./prepare-update.mjs";

const SHA = "b".repeat(40);
const digest = (b) => createHash("sha256").update(b).digest("hex");
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function archive(files) {
  const locals=[], centers=[];
  let offset=0;
  for (const [name, data] of files) {
    const filename=Buffer.from(name), body=Buffer.from(data);
    const crc=crc32(body);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,filename,body);centers.push(central,filename);
    offset+=local.length+filename.length+body.length;
  }
  const centralData=Buffer.concat(centers), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralData,end]);
}
function fixtureFiles() {
  const server=Buffer.from("server"),web=Buffer.from("web");
  const meta={schemaVersion:1,kind:"akariya-prebuilt",sourceSha:SHA,nodeMajorMin:22,
    artifacts:[{path:"apps/server/dist/server.mjs",size:server.length,sha256:digest(server)},
      {path:"apps/web/dist/index.html",size:web.length,sha256:digest(web)}]};
  return [["apps/server/dist/server.mjs",server],["apps/web/dist/index.html",web],[".akariya-build.json",JSON.stringify(meta)],[".akariya-version",SHA]];
}
test("archive inspector accepts required release format",()=>{
  const entries=inspectReleaseZip(archive(fixtureFiles()));
  assert.equal(entries.some(x=>x.path==="apps/server/dist/server.mjs"),true);
  assert.equal(entries.some(x=>x.path===".akariya-version"),false);
});
test("release ZIP dot-root paths are normalized",()=>{
  const entries=inspectReleaseZip(archive([["./apps/server/dist/server.mjs","ok"]]));
  assert.equal(entries[0].path,"apps/server/dist/server.mjs");
  assert.throws(()=>inspectReleaseZip(archive([["./../evil","no"]])),/Unsafe ZIP path/);
});
test("archive inspector rejects traversal, protected paths and duplicates",()=>{
  for(const name of ["../oops",".env","data/history.json","C:/bad","a\\b"]) {
    assert.throws(()=>inspectReleaseZip(archive([[name,"bad"]])),/Unsafe ZIP path/);
  }
  assert.throws(()=>inspectReleaseZip(archive([["A.txt","a"],["a.txt","b"]])),/Duplicate/);
});
test("archive inspector rejects corrupted bytes",()=>{
  const bytes=archive([["file.txt","hello"]]);
  const index=bytes.indexOf("hello");bytes[index]=0xff;
  assert.throws(()=>inspectReleaseZip(bytes),/integrity mismatch/);
});
test("trusted SHA mismatch prevents any staging",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-stage-"));
  const file=path.join(root,"release.zip");
  const { writeFile }=await import("node:fs/promises");
  try {
    await writeFile(file,archive(fixtureFiles()));
    await assert.rejects(prepareTrustedRelease({root,archivePath:file,trustedSha256:"0".repeat(64),sourceSha:SHA}),/Trusted archive digest mismatch/);
    await assert.rejects(readFile(path.join(root,".updates","ready.json")),{code:"ENOENT"});
  } finally {await rm(root,{recursive:true,force:true});}
});
test("trusted release creates launcher-compatible ready manifest",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"akariya-stage-"));
  const file=path.join(root,"release.zip");
  const { writeFile }=await import("node:fs/promises");
  try {
    const bytes=archive(fixtureFiles());
    await writeFile(file,bytes);
    const result=await prepareTrustedRelease({root,archivePath:file,trustedSha256:digest(bytes),sourceSha:SHA});
    assert.equal(result.sha,SHA);
    const ready=JSON.parse(await readFile(path.join(root,".updates","ready.json"),"utf8"));
    assert.equal(ready.sha,SHA);
    assert.ok(ready.files.some(x=>x.path==="apps/server/dist/server.mjs"));
    assert.equal((await readFile(path.join(root,".updates","staging","apps/server/dist/server.mjs"))).toString(),"server");
  } finally {await rm(root,{recursive:true,force:true});}
});
