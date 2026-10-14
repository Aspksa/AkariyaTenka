import { lstat, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
export async function rollbackSnapshots(root: string): Promise<{id:string;revision:string}[]> {
  const base = path.join(root, ".runtime", "github-updater", "backups");
  let entries;
  try { entries = await readdir(base, {withFileTypes:true}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const snapshots: {id:string;revision:string;modified:number}[] = [];
  for (const entry of entries) {
    if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const folder = path.join(base, entry.name);
    try {
      const marker = path.join(folder, ".akariya-backup.json");
      const versionPath = path.join(folder, ".akariya-version");
      const [info, versionInfo] = await Promise.all([lstat(marker), lstat(versionPath)]);
      if (!info.isFile() || info.isSymbolicLink() || !versionInfo.isFile() || versionInfo.isSymbolicLink()) continue;
      const data: unknown = JSON.parse(await readFile(marker, "utf8"));
      const version = (await readFile(versionPath, "utf8")).trim();
      if (!data || typeof data !== "object" || !("kind" in data) ||
          data.kind !== "akariya-github-backup" || !("schemaVersion" in data) ||
          data.schemaVersion !== 1 || !SHA.test(version)) continue;
      const names = await readdir(folder);
      if (!["scripts", "apps", "packages", "package.json", "package-lock.json", "AKARIYA.bat"]
        .every(name => names.includes(name))) continue;
      snapshots.push({id:entry.name, revision:version, modified:(await lstat(folder)).mtimeMs});
    } catch { /* unrecognized/invalid backup is ignored */ }
  }
  return snapshots.sort((a,b)=>b.modified-a.modified).slice(0,3).map(({id,revision})=>({id,revision}));
}
export function createRollbackRoutes(root: string) {
  return {
    list: async () => JSON.stringify({ backups: await rollbackSnapshots(root) }),
    request: async (payload: unknown) => {
      if (!payload || typeof payload !== "object" || !("id" in payload) ||
          typeof payload.id !== "string" || !UUID.test(payload.id))
        throw new Error("Invalid rollback request");
      const snapshots = await rollbackSnapshots(root);
      if (!snapshots.some(item => item.id === payload.id)) throw new Error("Rollback backup is unavailable");
      const state = path.join(root, ".runtime", "github-updater");
      await mkdir(state, {recursive:true});
      await writeFile(path.join(state, "rollback-request.json"), JSON.stringify({id:payload.id})+"\n",
        {flag:"wx",mode:0o600});
      return JSON.stringify({accepted:true});
    }
  };
}
