import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPortableSyncLocks } from "./portable-sync-lock.mjs";
import { readPortableSnapshot } from "./portable-state.mjs";
import { snapshotPortableFiles } from "./portable-transfer.mjs";
import { assertSamePortableInstallation } from "./portable-identity.mjs";
import { backupPortableState, verifyPortableBackup } from "./portable-backup.mjs";

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function disjoint(a,b) {const r=path.relative(a,b),q=path.relative(b,a);
 const inside=s=>s===""||(s!==".."&&!s.startsWith(".."+path.sep)&&!path.isAbsolute(s));
 if(inside(r)||inside(q)) throw Error("Overlapping roots");}
export async function planPortableReplacement(from,to) {
 from=path.resolve(from); to=path.resolve(to);disjoint(from,to);
 const identity=await assertSamePortableInstallation(from,to);
 if(identity.legacy) throw Error("Matching portable identities are required");
 const [a,b]=await Promise.all([readPortableSnapshot(from),readPortableSnapshot(to)]);
 if(!a||!b||!same(a.files,b.files)) throw Error("A shared immutable baseline is required");
 const [source,target]=await Promise.all([snapshotPortableFiles(from),snapshotPortableFiles(to)]);
 const replace=[],add=[],conflicts=[],sourceDeleted=[];
 const names=new Set([...Object.keys(a.files),...Object.keys(source),...Object.keys(target)]);
 for(const n of [...names].sort()){
   if(n===".akariya-installation.json") continue;
   const old=a.files[n],s=source[n],d=target[n];
   if(s===old||s===d) continue;
   if(s===undefined){sourceDeleted.push(n);continue;}
   if(d!==old){conflicts.push(n);continue;}
   if(d===undefined) add.push(n); else replace.push(n);
 }
 return {replace,add,conflicts,sourceDeleted,source,target};
}
export async function applyPortableReplacement(from,to,{acknowledgeStopped=false}={}) {
 if(!acknowledgeStopped) throw Error("Stop all Akariya instances and writers first");
 from=path.resolve(from);to=path.resolve(to);
 return withPortableSyncLocks([from,to],async()=>{
   const plan=await planPortableReplacement(from,to);
   if(plan.conflicts.length||plan.sourceDeleted.length) throw Error("Divergence or deletions require manual resolution");
   if(!plan.replace.length&&!plan.add.length)return {changed:0,backupId:null,verified:true};
   const backup=await backupPortableState(to,{acknowledgeStopped:true});
   await verifyPortableBackup(to,backup.backupId);
   const directory=path.join(to,".portable-state","transactions",randomUUID());
   await mkdir(directory,{recursive:true});
   const applied=[];
   try {
     if(!same(await snapshotPortableFiles(from),plan.source)||!same(await snapshotPortableFiles(to),plan.target))
       throw Error("Copies changed since planning");
     for(const n of [...plan.replace,...plan.add]){
       const seg=n.split("/"),src=path.join(from,...seg),dst=path.join(to,...seg);
       const pre=await snapshotPortableFiles(to);
       if(pre[n]!==plan.target[n]) throw Error("Concurrent destination change");
       await mkdir(path.dirname(dst),{recursive:true});
       const tmp=path.join(directory,randomUUID());
       await copyFile(src,tmp);
       const {createHash}=await import("node:crypto");
       const hash=createHash("sha256").update(await readFile(tmp)).digest("hex");
       if(hash!==plan.source[n]) throw Error("Source changed during copy");
       if(plan.replace.includes(n)) {
         const old=path.join(directory,randomUUID()+".bak");
         await rename(dst,old);
         try {await rename(tmp,dst);}catch(e){await rename(old,dst);throw e;}
         applied.push({dst,old});
       } else {
         await rename(tmp,dst);
         applied.push({dst,old:null});
       }
     }
     const expected={...plan.target};
     for(const n of [...plan.replace,...plan.add])expected[n]=plan.source[n];
     if(!same(await snapshotPortableFiles(to),Object.fromEntries(Object.entries(expected).sort(([a],[b])=>a.localeCompare(b)))))
       throw Error("Final checksum verification failed");
     await writeFile(path.join(directory,"success.json"),JSON.stringify({backupId:backup.backupId,changed:applied.length})+"\n");
     return {changed:applied.length,backupId:backup.backupId,verified:true};
   } catch(e) {
     for(const {dst,old} of applied.reverse()){
       try {await rm(dst,{force:true});if(old)await rename(old,dst);}catch{throw Error("Rollback failed; inspect backup "+backup.backupId);}
     }
     throw e;
   } finally {await rm(directory,{recursive:true,force:true});}
 });
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self){const [mode,a,b,flag]=process.argv.slice(2);
 const task=mode==="plan"?planPortableReplacement(a,b):mode==="apply"?applyPortableReplacement(a,b,{acknowledgeStopped:flag==="--both-stopped"}):null;
 if(!task){console.error("Usage: node scripts/portable-replace.mjs plan|apply <source> <destination> [--both-stopped]");process.exitCode=2;}
 else task.then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
