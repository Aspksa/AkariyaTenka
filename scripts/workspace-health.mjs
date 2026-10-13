import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const AKARIYA_WORKSPACES = Object.freeze([
  ["@akariya/core", "packages/core"],
  ["@akariya/contracts", "packages/contracts"],
  ["@akariya/persistence", "packages/persistence"],
  ["@akariya/security", "packages/security"],
  ["@akariya/assistant", "packages/assistant"],
  ["@akariya/server", "apps/server"],
  ["@akariya/web", "apps/web"],
]);

function workspaceLinkPath(root, name) {
  return path.join(root, "node_modules", ...name.split("/"));
}

function normalizeRealPath(value) {
  const resolved = realpathSync.native ? realpathSync.native(value) : realpathSync(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function inspectWorkspaceLinks(root) {
  return AKARIYA_WORKSPACES.map(([name, relativeSource]) => {
    const source = path.join(root, relativeSource);
    const link = workspaceLinkPath(root, name);
    const packageFile = path.join(link, "package.json");

    if (!existsSync(path.join(source, "package.json"))) {
      return { name, ok: false, reason: "workspace-source-missing" };
    }
    if (!existsSync(packageFile)) {
      return { name, ok: false, reason: "workspace-link-missing" };
    }

    try {
      const linkStat = lstatSync(link);
      if (!(linkStat.isSymbolicLink() || linkStat.isDirectory())) {
        return { name, ok: false, reason: "workspace-link-invalid-type" };
      }
      const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
      if (manifest?.name !== name) {
        return { name, ok: false, reason: "workspace-package-name-mismatch" };
      }
      if (normalizeRealPath(link) !== normalizeRealPath(source)) {
        return { name, ok: false, reason: "workspace-link-wrong-target" };
      }
      return { name, ok: true };
    } catch {
      return { name, ok: false, reason: "workspace-link-unreadable" };
    }
  });
}

export function missingWorkspaceLinks(root) {
  return inspectWorkspaceLinks(root).filter((item) => !item.ok).map((item) => item.name);
}
