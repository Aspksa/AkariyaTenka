import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {initializePortableIdentity} from "./portable-identity.mjs";
import {discoverPortableProjects} from "./portable-discover.mjs";
test("finds portable copy by installation marker and launcher",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"akariya-discover-"));
 const project=path.join(root,"AkariyaTenka");
 try{await mkdir(project);const id=await initializePortableIdentity(project);await writeFile(path.join(project,"AKARIYA.bat"),"@echo off");
 assert.deepEqual(await discoverPortableProjects({roots:[root]}),[{path:project,installationId:id}]);}
 finally{await rm(root,{recursive:true,force:true});}
});
