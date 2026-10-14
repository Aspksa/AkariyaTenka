import { randomUUID } from "node:crypto";
import { mkdir, copyFile, rename, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotPortableFiles } from "./portable-transfer.mjs";
import { readPortableIdentity } from "./portable-identity.mjs";

function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
export async function backupPortableState(root, { acknowledgeStopped = false } = {}) {
  if (!acknowledgeStopped) throw Error("Both applications and other writers must be stopped");
  const base = path.resolve(root);
  const id = await readPortableIdentity(base);
  if (!id) throw Error("Portable installation identity is required");
  const expected = await snapshotPortableFiles(base);
  const backups = path.join(base, ".portable-state", "backups");
  await mkdir(backups, { recursive: true });
  const token = randomUUID();
  const staging = path.join(backups, ".pending-" + token);
  const final = path.join(backups, token);
  await mkdir(staging, {recursive:false});
  try {
    const content = path.join(staging, "files");
    await mkdir(content);
    for (const name of Object.keys(expected)) {
      const segments = name.split("/");
      const dst = path.join(content, ...segments);
      await mkdir(path.dirname(dst), {recursive:true});
      await copyFile(path.join(base, ...segments),dst);
    }
    if (!equal(await snapshotPortableFiles(content), expected) ||
        !equal(await snapshotPortableFiles(base), expected)) throw Error("Source changed or backup checksum mismatch");
    const record = {schemaVersion:1,installationId:id,files:expected};
    await writeFile(path.join(staging,"manifest.json"),JSON.stringify(record)+"\n",{flag:"wx"});
    await rename(staging,final);
    return { backupId:token, files:Object.keys(expected).length, verified:true };
  } catch(e) {
    await rm(staging,{recursive:true,force:true});
    throw e;
  }
}
export async function verifyPortableBackup(root, backupId) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(backupId)) throw Error("Invalid backup identifier");
  const dir=path.join(path.resolve(root),".portable-state","backups",backupId);
  const record=JSON.parse(await readFile(path.join(dir,"manifest.json"),"utf8"));
  const id=await readPortableIdentity(root);
  if (!id || record.schemaVersion!==1 || record.installationId!==id ||
      !record.files || typeof record.files!=="object" || Array.isArray(record.files)) throw Error("Invalid backup manifest");
  const actual=await snapshotPortableFiles(path.join(dir,"files"));
  if (!equal(actual,record.files)) throw Error("Backup checksum mismatch");
  return {verified:true,files:Object.keys(actual).length};
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self){
 const [mode,root,arg]=process.argv.slice(2);
 const task=mode==="create"&&root?backupPortableState(root,{acknowledgeStopped:arg==="--stopped"}):
            mode==="verify"&&root&&arg?verifyPortableBackup(root,arg):null;
 if(!task){console.error("Usage: node scripts/portable-backup.mjs create <root> --stopped | verify <root> <backup-id>");process.exitCode=2;}
 else task.then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
