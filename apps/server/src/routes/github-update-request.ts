import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubUpdateStatus } from "./github-updates.js";

const shaPattern = /^[0-9a-f]{40}$/;
export function createGithubUpdateRequest(root: string): (payload: unknown) => Promise<string> {
  return async (payload: unknown) => {
    if (typeof payload !== "object" || payload === null || !("sha" in payload) ||
        typeof payload.sha !== "string" || !shaPattern.test(payload.sha)) {
      throw new Error("Invalid update revision");
    }
    const status = await githubUpdateStatus(root);
    if (status.latest !== payload.sha.toLowerCase() || status.current === null || status.current === status.latest) {
      throw new Error("Update revision is not a new official GitHub main commit");
    }
    const directory = path.join(root, ".runtime", "github-updater");
    await mkdir(directory, { recursive: true });
    const requestPath = path.join(directory, "request.json");
    await writeFile(requestPath, JSON.stringify({ sha: status.latest }) + "\n", { flag: "wx", mode: 0o600 });
    return JSON.stringify({ accepted: true, sha: status.latest });
  };
}
