import { readFile } from "node:fs/promises";
import path from "node:path";

export interface UpdateStatus {
  readonly currentVersion: string | null;
  readonly publisherConfigured: boolean;
  readonly installationEnabled: false;
  readonly pendingRestart: boolean;
  readonly pendingConfirmation: boolean;
  readonly message: string;
}

const readOptional = async (file: string): Promise<string | null> =>
  readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

export function createUpdateStatusRoute(root: string) {
  const resolvedRoot = path.resolve(root);
  return async (): Promise<string> => {
    const [version, ready, pending] = await Promise.all([
      readOptional(path.join(resolvedRoot, ".akariya-version")),
      readOptional(path.join(resolvedRoot, ".updates", "ready.json")),
      readOptional(path.join(resolvedRoot, ".updates", "pending-confirm.json"))
    ]);
    const status: UpdateStatus = {
      currentVersion: version?.trim() || null,
      publisherConfigured: false,
      installationEnabled: false,
      pendingRestart: ready !== null,
      pendingConfirmation: pending !== null,
      message: "Publisher trust key not provisioned. Update installation is disabled."
    };
    return JSON.stringify(status);
  };
}
