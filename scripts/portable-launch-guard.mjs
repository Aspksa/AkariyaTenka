import { lstat } from "node:fs/promises";
import path from "node:path";

// Conservative preflight: a sync lock means launch must not modify project state.
export async function assertPortableLaunchAllowed(root) {
  const state = path.join(path.resolve(root), ".portable-state");
  try {
    const info = await lstat(state);
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error("Unsafe portable state path; startup refused");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  try {
    await lstat(path.join(state, "sync.lock"));
    throw Error("Portable synchronization lock present; stop sync or inspect stale lock before launch");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
