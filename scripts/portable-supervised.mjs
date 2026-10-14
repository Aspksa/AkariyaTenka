import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { comparePortableAncestry } from "./portable-state.mjs";
import { applyPortableReplacement } from "./portable-replace.mjs";
import { transferPortableCopy } from "./portable-transfer.mjs";
import { restorePortableBackup } from "./portable-restore.mjs";
import { withPortableSyncLocks } from "./portable-sync-lock.mjs";

export const PORTABLE_EXIT_CODE = 76;
const statePath = root => path.join(root, ".portable-state");
const requestPath = root => path.join(statePath(root), "pending-transfer.json");
const resultPath = root => path.join(statePath(root), "last-transfer.json");
const actions = new Set(["copy", "compare", "sync-to", "sync-from", "restore"]);
function overlaps(a, b) {
  const r = path.relative(a,b), s=path.relative(b,a);
  const inside = t => !t || (t !== ".." && !t.startsWith(".." + path.sep) && !path.isAbsolute(t));
  return inside(r) || inside(s);
}
export function validatePortableAction(root, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      Object.keys(candidate).some(k => !["action","other","backupId","confirm"].includes(k)) ||
      !actions.has(candidate.action) || candidate.confirm !== "ПЕРЕНЕСТИ" ||
      typeof candidate.other !== "string" || candidate.other.length > 1024 ||
      !path.isAbsolute(candidate.other) || /[\r\n\0]/.test(candidate.other)) throw Error("Invalid portable transfer request");
  const other = path.resolve(candidate.other);
  if (overlaps(path.resolve(root),other)) throw Error("Portable destination cannot overlap the running installation");
  if (candidate.action === "restore" &&
      (typeof candidate.backupId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(candidate.backupId))) throw Error("Invalid backup identifier");
  if (candidate.action !== "restore" && candidate.backupId !== undefined) throw Error("Unexpected backup identifier");
  return { action:candidate.action, other, ...(candidate.action==="restore"?{backupId:candidate.backupId}:{}) };
}
export async function queuePortableAction(root, input, sessionToken) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32) throw Error("Supervised session required");
  const request=validatePortableAction(root,input);
  await mkdir(statePath(root),{recursive:true});
  const record={schemaVersion:1,id:randomUUID(), session:createHash("sha256").update(sessionToken).digest("hex"),...request};
  await writeFile(requestPath(root),JSON.stringify(record)+"\n",{flag:"wx",mode:0o600});
  return {queued:true,action:record.action};
}
export async function performQueuedPortableAction(root, sessionToken) {
  const pending=requestPath(root), processing=path.join(statePath(root),"transfer-processing.json");
  await rename(pending,processing);
  try {
    const raw=await readFile(processing,"utf8");
    if (raw.length>4096) throw Error("Oversized transfer request");
    const stored=JSON.parse(raw);
    if (stored.schemaVersion!==1 ||
      stored.session!==createHash("sha256").update(sessionToken).digest("hex"))
      throw Error("Transfer request does not belong to current supervised launch");
    const action=validatePortableAction(root,{...stored,confirm:"ПЕРЕНЕСТИ"});
    let detail;
    if (action.action==="compare") detail=await comparePortableAncestry(root,action.other);
    else if (action.action==="copy") {
      detail=await withPortableSyncLocks([root],()=>transferPortableCopy(root,action.other));
    } else if (action.action==="sync-to")
      detail=await applyPortableReplacement(root,action.other,{acknowledgeStopped:true});
    else if (action.action==="sync-from")
      detail=await applyPortableReplacement(action.other,root,{acknowledgeStopped:true});
    else detail=await withPortableSyncLocks([root],()=>restorePortableBackup(root,action.backupId,action.other,{acknowledgeStopped:true}));
    const result={schemaVersion:1,id:stored.id,action:action.action,status:"success",detail,at:new Date().toISOString()};
    await writeFile(resultPath(root),JSON.stringify(result)+"\n");
    return result;
  } catch(error) {
    const result={schemaVersion:1,status:"failed",error:error instanceof Error?error.message:String(error),at:new Date().toISOString()};
    await writeFile(resultPath(root),JSON.stringify(result)+"\n");
    return result;
  } finally {
    await rm(processing,{force:true});
  }
}
export async function readPortableActionResult(root) {
  try { return JSON.parse(await readFile(resultPath(root),"utf8")); }
  catch(error){if(error.code==="ENOENT") return null;throw error;}
}
