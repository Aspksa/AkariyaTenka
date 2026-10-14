import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { realpath } from "node:fs/promises";

const LOCK_NAME = "sync.lock";
export async function withPortableSyncLocks(roots, task) {
  const resolved = await Promise.all(roots.map(root => realpath(path.resolve(root))));
  if (new Set(resolved.map(root => process.platform === "win32" ? root.toLowerCase() : root)).size !== resolved.length) {
    throw Error("Cannot lock overlapping or duplicate installation roots");
  }
  const acquired = [];
  try {
    for (const root of [...resolved].sort()) {
      const state = path.join(root, ".portable-state");
      await mkdir(state, { recursive: true });
      const info = await lstat(state);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe portable state directory");
      const lock = path.join(state, LOCK_NAME);
      try {
        await mkdir(lock);
      } catch (error) {
        if (error.code === "EEXIST") throw Error("Portable synchronization already locked: " + root);
        throw error;
      }
      const nonce = randomUUID();
      acquired.push({lock, nonce, owned: false});
      await writeFile(path.join(lock, "owner.json"),
        JSON.stringify({schemaVersion:1,nonce,pid:process.pid,createdAt:new Date().toISOString()})+"\n",
        { flag: "wx", mode: 0o600 });
      acquired[acquired.length - 1].owned = true;
    }
    return await task();
  } finally {
    for (const {lock,nonce,owned} of acquired.reverse()) {
      if (!owned) {
        try { await rm(lock, { recursive: true }); } catch { /* retained for manual inspection */ }
        continue;
      }
      try {
        const record = JSON.parse(await readFile(path.join(lock,"owner.json"),"utf8"));
        if (record.nonce === nonce) await rm(lock,{recursive:true});
      } catch { /* Preserve the lock if its ownership cannot be verified. */ }
    }
  }
}
