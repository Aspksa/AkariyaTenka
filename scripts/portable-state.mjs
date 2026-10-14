import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPortableIdentity } from "./portable-identity.mjs";
import { snapshotPortableFiles } from "./portable-transfer.mjs";

const SNAPSHOT_FILE = ".portable-state/snapshot.json";
const SHA = /^[0-9a-f]{64}$/;
function validate(value, id) {
 if (!value || typeof value !== "object" || Array.isArray(value) ||
     Object.keys(value).sort().join(",") !== "files,installationId,schemaVersion" ||
     value.schemaVersion !== 1 || value.installationId !== id ||
     !value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw Error("Invalid portable snapshot");
 for (const [name, hash] of Object.entries(value.files)) {
  if (typeof name !== "string" || name.startsWith("/") || name.includes("\\") ||
      name.split("/").some(p=>!p || p==="." || p==="..") || typeof hash !== "string" || !SHA.test(hash))
    throw Error("Invalid portable snapshot file");
 }
 return value.files;
}
export async function createPortableSnapshot(root) {
 const id = await readPortableIdentity(root);
 if (!id) throw Error("Portable installation identity required before snapshot");
 const files = await snapshotPortableFiles(root);
 const directory = path.join(root,".portable-state");
 await mkdir(directory,{recursive:true});
 const temp = path.join(directory,".snapshot-"+randomUUID()+".tmp");
 const payload = JSON.stringify({schemaVersion:1,installationId:id,files})+"\n";
 await writeFile(temp,payload,{flag:"wx",mode:0o600});
 const filename=path.join(root,SNAPSHOT_FILE);
 // Snapshots are deliberately immutable until explicit future baseline-advance workflow.
 try {
   await writeFile(filename,payload,{flag:"wx",mode:0o600});
 } finally {
   const { rm }=await import("node:fs/promises");
   await rm(temp,{force:true});
 }
 return { installationId:id,fileCount:Object.keys(files).length };
}
export async function readPortableSnapshot(root) {
 const id = await readPortableIdentity(root);
 if (!id) return null;
 let raw;
 try {raw=await readFile(path.join(root,SNAPSHOT_FILE),"utf8");}
 catch(e){if(e.code==="ENOENT")return null;throw e;}
 if (Buffer.byteLength(raw)>16*1024*1024) throw Error("Portable snapshot too large");
 let parsed;
 try {parsed=JSON.parse(raw);}catch{throw Error("Invalid portable snapshot");}
 return {installationId:id,files:validate(parsed,id)};
}
export async function comparePortableAncestry(left,right) {
 const [a,b]=await Promise.all([readPortableSnapshot(left),readPortableSnapshot(right)]);
 if (!a || !b) return {status:"unavailable", changedLeft:[],changedRight:[],conflicts:[]};
 if (a.installationId !== b.installationId || JSON.stringify(a.files)!==JSON.stringify(b.files))
   return {status:"different-baseline",changedLeft:[],changedRight:[],conflicts:[]};
 const [lf,rf]=await Promise.all([snapshotPortableFiles(left),snapshotPortableFiles(right)]);
 const names=[...new Set([...Object.keys(a.files),...Object.keys(lf),...Object.keys(rf)])].sort();
 const changedLeft=names.filter(n=>lf[n]!==a.files[n]);
 const changedRight=names.filter(n=>rf[n]!==a.files[n]);
 const both=new Set(changedRight);
 const conflicts=changedLeft.filter(n=>both.has(n)&&lf[n]!==rf[n]);
 return {status:"shared-baseline",changedLeft,changedRight,conflicts};
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self){
 const [mode,a,b]=process.argv.slice(2);
 const task=mode==="init"&&a?createPortableSnapshot(a):mode==="compare"&&a&&b?comparePortableAncestry(a,b):null;
 if(!task){console.error("Usage: node scripts/portable-state.mjs init <root> | compare <root1> <root2>");process.exitCode=2;}
 else task.then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
