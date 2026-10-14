import { randomUUID } from "node:crypto";
import { mkdir, copyFile, lstat, rename, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPortableBackup } from "./portable-backup.mjs";
import { snapshotPortableFiles } from "./portable-transfer.mjs";
import { readPortableIdentity } from "./portable-identity.mjs";

function contained(parent, child) {
 const relative = path.relative(parent, child);
 return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}
export async function restorePortableBackup(root, backupId, destination, {acknowledgeStopped = false} = {}) {
 if (!acknowledgeStopped) throw Error("Application and all other writers must be stopped");
 const sourceRoot = await realpath(path.resolve(root));
 const final = path.resolve(destination);
 const parent = await realpath(path.dirname(final));
 const target = path.join(parent, path.basename(final));
 if (contained(sourceRoot,target) || contained(target,sourceRoot))
   throw Error("Backup restore destination must not overlap source project");
 try { await lstat(target); throw Error("Destination already exists; refusing overwrite"); }
 catch(e) { if (e.code !== "ENOENT") throw e; }
 // Full backup verification before touching the target parent.
 await verifyPortableBackup(sourceRoot,backupId);
 const original = path.join(sourceRoot,".portable-state","backups",backupId,"files");
 const expected = await snapshotPortableFiles(original);
 const stage = path.join(parent,"."+path.basename(target)+".restore-"+randomUUID());
 await mkdir(stage,{recursive:false});
 try {
   for (const name of Object.keys(expected)) {
     const parts=name.split("/");
     const dst=path.join(stage,...parts);
     await mkdir(path.dirname(dst),{recursive:true});
     await copyFile(path.join(original,...parts),dst);
   }
   const actual = await snapshotPortableFiles(stage);
   if (JSON.stringify(actual)!==JSON.stringify(expected)) throw Error("Restored files failed checksum verification");
   // Re-verify source in case backup was modified while copying.
   await verifyPortableBackup(sourceRoot,backupId);
   // Do not replace a destination which appeared meanwhile.
   try { await lstat(target); throw Error("Destination appeared during restore"); }
   catch(e) { if (e.code !== "ENOENT") throw e; }
   await rename(stage,target);
   return {restored:true,destination:target,files:Object.keys(expected).length,
     installationId:await readPortableIdentity(sourceRoot)};
 } catch(e) {
   await rm(stage,{recursive:true,force:true});
   throw e;
 }
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self) {
 const [mode,root,id,target,flag]=process.argv.slice(2);
 if(mode!=="restore" || !root || !id || !target || flag!=="--stopped") {
   console.error("Usage: node scripts/portable-restore.mjs restore <project-root> <backup-id> <new-destination> --stopped");
   process.exitCode=2;
 } else restorePortableBackup(root,id,target,{acknowledgeStopped:true})
   .then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
