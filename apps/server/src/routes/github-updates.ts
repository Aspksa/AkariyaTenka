import { readFile, statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const REPOSITORY = "Aspksa/AkariyaTenka";
const API = "https://api.github.com/repos/" + REPOSITORY + "/commits/main";
const SHA = /^[a-f0-9]{40}$/i;

export async function currentRevision(root: string): Promise<string | null> {
  try {
    const marker = (await readFile(path.join(root, ".akariya-version"), "utf8")).trim();
    if (SHA.test(marker)) return marker.toLowerCase();
  } catch { /* A source checkout may not carry a version marker. */ }
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      timeout: 3000, windowsHide: true
    });
    const sha = stdout.trim();
    return SHA.test(sha) ? sha.toLowerCase() : null;
  } catch { return null; }
}

export async function availableUpdateDiskBytes(root: string): Promise<number | null> {
  try {
    const disk = await statfs(root);
    const bytes = disk.bavail * disk.bsize;
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
  } catch { return null; }
}

// Installation performs a second disk check before downloading. The 768 MiB
// threshold covers a working source build, archive extraction and rollback.
export const MIN_UPDATE_FREE_BYTES = 768 * 1024 * 1024;
async function githubChanges(current: string | null, latest: string, request: typeof fetch): Promise<string[]> {
  if (!current || current === latest) return [];
  try {
    const response = await request("https://api.github.com/repos/Aspksa/AkariyaTenka/compare/" +
      current + "..." + latest, {
      headers: { accept: "application/vnd.github+json", "user-agent": "AkariyaTenka-Updater" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("commits" in body) ||
        !Array.isArray((body as { commits: unknown }).commits)) return [];
    const changes: string[] = [];
    const commits = (body as { commits: unknown[] }).commits;
    for (const item of commits.slice(-8).reverse()) {
      if (!item || typeof item !== "object" || !("commit" in item)) continue;
      const commit = (item as { commit: unknown }).commit;
      if (!commit || typeof commit !== "object" || !("message" in commit)) continue;
      const message = (commit as {message: unknown}).message;
      if (typeof message === "string" && message.trim())
        changes.push(message.split("\\n")[0].slice(0, 150));
    }
    return changes;
  } catch { return []; }
}

export async function githubUpdateStatus(
  root: string,
  request: typeof fetch = fetch
): Promise<{ repository: string; branch: string; current: string | null; latest: string; updateAvailable: boolean | null; compareUrl: string; changes: string[]; freeBytes: number | null; enoughSpace: boolean | null }> {
  const response = await request(API, {
    headers: { accept: "application/vnd.github+json", "user-agent": "AkariyaTenka-Updater" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("GitHub update check failed (HTTP " + response.status + ")");
  const body: unknown = await response.json();
  const latest = typeof body === "object" && body !== null && "sha" in body ? (body as {sha: unknown}).sha : null;
  if (typeof latest !== "string" || !SHA.test(latest)) throw new Error("GitHub returned an invalid revision");
  const current = await currentRevision(root);
  // An unknown version can never be safely classified as outdated.
  const [changes, freeBytes] = await Promise.all([
    githubChanges(current, latest.toLowerCase(), request),
    availableUpdateDiskBytes(root)
  ]);
  return {
    changes, freeBytes, enoughSpace: freeBytes === null ? null : freeBytes >= MIN_UPDATE_FREE_BYTES,
    repository: REPOSITORY, branch: "main", current, latest: latest.toLowerCase(),
    updateAvailable: current ? current !== latest.toLowerCase() : null,
    compareUrl: "https://github.com/" + REPOSITORY + "/compare/" + (current ?? latest) + "...main"
  };
}

export function createGithubUpdateRoute(root: string): () => Promise<string> {
  return async () => JSON.stringify(await githubUpdateStatus(root));
}
