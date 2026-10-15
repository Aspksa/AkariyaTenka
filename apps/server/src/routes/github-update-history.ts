import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const allowed = new Set(["download_started", "validated", "prepared", "confirmed", "rolled_back", "failed"]);
const sha = /^[0-9a-f]{40}$/;
export async function githubUpdateHistory(root: string): Promise<{
  events: { at: string; event: string; revision: string | null }[]
}> {
  const file = path.join(root, ".runtime", "github-updater", "history.jsonl");
  let info;
  try { info = await lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [] };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
    throw new Error("Update history file is unsafe or too large");
  const lines = (await readFile(file, "utf8")).trim().split("\n").slice(-200);
  const events: { at: string; event: string; revision: string | null }[] = [];
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    if (typeof e.event !== "string" || !allowed.has(e.event) ||
        typeof e.at !== "string" || !/^\d{4}-\d\d-\d\dT/.test(e.at) ||
        (e.revision !== null && (typeof e.revision !== "string" || !sha.test(e.revision)))) continue;
    events.push({ at: e.at, event: e.event, revision: e.revision as string | null });
  }
  return { events: events.reverse() };
}

export interface UpdateDownloadProgress {
  phase: string; received: number; total: number | null; startedAt: string; at: string;
}
export async function githubUpdateProgress(root: string): Promise<UpdateDownloadProgress | null> {
  const file = path.join(root, ".runtime", "github-updater", "progress.json");
  let info;
  try { info = await lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) return null;
  let record: unknown;
  try { record = JSON.parse(await readFile(file, "utf8")); } catch { return null; }
  if (!record || typeof record !== "object") return null;
  const v = record as Record<string, unknown>;
  if (typeof v.phase !== "string" ||
      !["starting","downloading","downloaded","retrying","validating","installing","restarting","confirmed","failed","rolled_back"].includes(v.phase) ||
      typeof v.received !== "number" || !Number.isSafeInteger(v.received) || v.received < 0 ||
      (v.total !== null && (typeof v.total !== "number" || !Number.isSafeInteger(v.total) || v.total < 0)) ||
      typeof v.startedAt !== "string" || Number.isNaN(Date.parse(v.startedAt)) ||
      typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) return null;
  return v as unknown as UpdateDownloadProgress;
}
export function createGithubUpdateHistoryRoute(root: string): () => Promise<string> {
  return async () => {
    const [history, progress] = await Promise.all([githubUpdateHistory(root), githubUpdateProgress(root)]);
    return JSON.stringify({ ...history, progress });
  };
}
