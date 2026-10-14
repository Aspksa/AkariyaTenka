import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@akariya/core";
import { githubUpdateStatus } from "./github-updates.js";

const shaPattern = /^[0-9a-f]{40}$/;
// GitHub API replicas can briefly disagree about main right after a merge, so a
// mismatch is re-checked once before the request is rejected.
const REPLICA_RETRY_MS = 1500;

function conflict(message: string): AppError {
  return new AppError({ code: "CONFLICT", message });
}

export function createGithubUpdateRequest(
  root: string,
  request: typeof fetch = fetch,
  retryDelayMs = REPLICA_RETRY_MS
): (payload: unknown) => Promise<string> {
  return async (payload: unknown) => {
    if (typeof payload !== "object" || payload === null || !("sha" in payload) ||
        typeof payload.sha !== "string" || !shaPattern.test(payload.sha)) {
      throw new AppError({ code: "VALIDATION", message: "Invalid update revision" });
    }
    const requested = payload.sha.toLowerCase();
    let status = await githubUpdateStatus(root, request);
    if (status.latest !== requested) {
      await delay(retryDelayMs);
      status = await githubUpdateStatus(root, request);
    }
    if (status.enoughSpace === false) throw conflict("Not enough free disk space (768 MiB required)");
    // An unversioned copy (for example a ZIP download) may install the reviewed latest revision:
    // the updater backs up the current files first and records the version marker afterwards.
    if (status.current === status.latest) throw conflict("Akariya is already up to date");
    // main moved on after the user reviewed the update: they must approve the new revision.
    if (status.latest !== requested) throw conflict("GitHub main has a newer revision; check for updates again");
    const directory = path.join(root, ".runtime", "github-updater");
    await mkdir(directory, { recursive: true });
    const requestPath = path.join(directory, "request.json");
    await writeFile(requestPath, JSON.stringify({ sha: status.latest }) + "\n", { flag: "wx", mode: 0o600 });
    return JSON.stringify({ accepted: true, sha: status.latest });
  };
}
