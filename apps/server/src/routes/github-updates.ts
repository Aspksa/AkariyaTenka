import { readFile } from "node:fs/promises";
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

export async function githubUpdateStatus(
  root: string,
  request: typeof fetch = fetch
): Promise<{ repository: string; branch: string; current: string | null; latest: string; updateAvailable: boolean | null; compareUrl: string }> {
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
  return {
    repository: REPOSITORY, branch: "main", current, latest: latest.toLowerCase(),
    updateAvailable: current ? current !== latest.toLowerCase() : null,
    compareUrl: "https://github.com/" + REPOSITORY + "/compare/" + (current ?? latest) + "...main"
  };
}

export function createGithubUpdateRoute(root: string): () => Promise<string> {
  return async () => JSON.stringify(await githubUpdateStatus(root));
}
