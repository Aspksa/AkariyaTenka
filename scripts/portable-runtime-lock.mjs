import { mkdir, rm, readFile, writeFile, lstat, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const state = root => path.join(root, ".portable-state");
const check = async p => { try { await lstat(p); return true; } catch(e) { if(e.code==="ENOENT") return false; throw e; } };
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch(error) {
    if (error.code === "ESRCH") return false;
    return true; // EPERM and unknown errors must never authorize recovery.
  }
}
async function recoverDeadOwner(lock) {
  const info = await lstat(lock);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe runtime lock; manual inspection required");
  let owner;
  try { owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")); }
  catch { throw Error("Runtime lock metadata missing or invalid; manual inspection required"); }
  if (!owner || typeof owner.nonce !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(owner.nonce) ||
      !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    throw Error("Runtime lock owner invalid; manual inspection required");
  }
  if (processAlive(owner.pid)) throw Error("Akariya already running (PID " + owner.pid + ")");
  // Rename the entire dead owner's lock instead of deleting it. Preserve evidence
  // and do not touch synchronization locks or user data.
  const archived = lock + ".stale-" + randomUUID();
  await rename(lock, archived);
  // A separate launcher may have raced to recover the same lock. Only the
  // winner continues, and a new lock must still be acquired exclusively.
  return archived;
}
export async function acquirePortableRuntime(root) {
  const dir = state(root);
  await mkdir(dir, { recursive: true });
  const dirInfo = await lstat(dir);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw Error("Unsafe portable state directory");
  if (await check(path.join(dir,"sync.lock"))) throw Error("Portable synchronization active");
  const lock = path.join(dir,"runtime.lock"), nonce = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try { await mkdir(lock); acquired = true; }
    catch(error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt > 0) throw Error("Akariya already running or runtime lock in use");
      try { await recoverDeadOwner(lock); }
      catch(recoveryError) {
        if (recoveryError.code === "ENOENT") continue; // Another launcher recovered it.
        throw recoveryError;
      }
    }
  }
  if (!acquired) throw Error("Akariya runtime lock could not be acquired");
  try {
    await writeFile(path.join(lock,"owner.json"), JSON.stringify({
      schemaVersion: 1, nonce, pid: process.pid, startedAt: new Date().toISOString()
    })+"\n",{flag:"wx",mode:0o600});
    if(await check(path.join(dir,"sync.lock"))) throw Error("Synchronization started while launching");
    return async () => {
      try {
        const record=JSON.parse(await readFile(path.join(lock,"owner.json"),"utf8"));
        if(record.nonce===nonce) await rm(lock,{recursive:true,force:true});
      } catch { /* Keep uncertain lock for inspection. */ }
    };
  } catch(error) {
    // This launcher created the directory and knows its nonce; no other
    // launcher can own it while the exclusive directory lock is held.
    await rm(lock,{recursive:true,force:true});
    throw error;
  }
}
export async function refuseActiveRuntime(root) {
  if(await check(path.join(state(root),"runtime.lock"))) throw Error("Running Akariya instance or stale runtime lock: "+root);
}
