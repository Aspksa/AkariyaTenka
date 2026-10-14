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
  const lines = (await readFile(file, "utf8")).trim().split("\n").slice(-40);
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

export function createGithubUpdateHistoryRoute(root: string): () => Promise<string> {
  return async () => JSON.stringify(await githubUpdateHistory(root));
}
