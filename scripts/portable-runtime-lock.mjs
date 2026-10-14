import { mkdir, rm, readFile, writeFile, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
const state = root => path.join(root, ".portable-state");
const check = async p => { try { await lstat(p); return true; } catch(e) { if(e.code==="ENOENT") return false; throw e; } };
export async function acquirePortableRuntime(root) {
 const dir=state(root); await mkdir(dir,{recursive:true});
 if(await check(path.join(dir,"sync.lock"))) throw Error("Portable synchronization active");
 const lock=path.join(dir,"runtime.lock"), nonce=randomUUID();
 try { await mkdir(lock); } catch(e) { if(e.code==="EEXIST") throw Error("Akariya already running or stale runtime lock"); throw e; }
 try {
   await writeFile(path.join(lock,"owner.json"), JSON.stringify({nonce,pid:process.pid})+"\n",{flag:"wx"});
   if(await check(path.join(dir,"sync.lock"))) throw Error("Synchronization started while launching");
   return async () => {
     try {const record=JSON.parse(await readFile(path.join(lock,"owner.json"),"utf8"));
       if(record.nonce===nonce) await rm(lock,{recursive:true,force:true}); }
     catch { /* Keep uncertain lock for inspection. */ }
   };
 } catch(e) {await rm(lock,{recursive:true,force:true});throw e;}
}
export async function refuseActiveRuntime(root) {
 if(await check(path.join(state(root),"runtime.lock"))) throw Error("Running Akariya instance or stale runtime lock: "+root);
}
