import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {initializePortableIdentity} from "./portable-identity.mjs";
import {transferPortableCopy} from "./portable-transfer.mjs";
import {createPortableSnapshot} from "./portable-state.mjs";
import {applyPortableReplacement} from "./portable-replace.mjs";

test("disconnected source is refused without modifying target data",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"akariya-unplug-"));
 const s=path.join(root,"external-ssd"),d=path.join(root,"local");
 try{
   await mkdir(s);await initializePortableIdentity(s);await writeFile(path.join(s,"memory.json"),"safe");
   await transferPortableCopy(s,d);await createPortableSnapshot(s);await createPortableSnapshot(d);
   await rm(s,{recursive:true,force:true}); // simulate source absent before operation
   await assert.rejects(applyPortableReplacement(s,d,{acknowledgeStopped:true}));
   assert.equal(await readFile(path.join(d,"memory.json"),"utf8"),"safe");
 }finally{await rm(root,{recursive:true,force:true});}
});
