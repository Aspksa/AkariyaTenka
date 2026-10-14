import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ID_FILE = ".akariya-installation.json";
export async function readPortableIdentity(root) {
  let content;
  try { content = await readFile(path.join(root, ID_FILE), "utf8"); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
  if (Buffer.byteLength(content) > 1024) throw Error("Oversized portable identity");
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw Error("Invalid portable identity"); }
  if (!parsed || Object.keys(parsed).sort().join(",") !== "installationId,schemaVersion" ||
    parsed.schemaVersion !== 1 || typeof parsed.installationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed.installationId)) {
    throw Error("Invalid portable identity");
  }
  return parsed.installationId;
}
export async function initializePortableIdentity(root) {
  const id = randomUUID();
  const content = JSON.stringify({schemaVersion:1, installationId:id}) + "\n";
  await writeFile(path.join(root,ID_FILE), content, {flag:"wx",mode:0o600});
  return id;
}
export async function assertSamePortableInstallation(left, right) {
  const [a,b] = await Promise.all([readPortableIdentity(left),readPortableIdentity(right)]);
  if (!a && !b) return {legacy:true,installationId:null};
  if (!a || !b || a !== b) throw Error("Portable installation identity differs or is missing; refusing synchronization");
  return {legacy:false,installationId:a};
}
const self = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (self) {
  const [command, root] = process.argv.slice(2);
  if (!root || command !== "init") {console.error("Usage: node scripts/portable-identity.mjs init <project-root>");process.exitCode=2;}
  else initializePortableIdentity(path.resolve(root)).then(id=>console.log("Portable installation ID: "+id))
    .catch(e=>{console.error(e.message);process.exitCode=1;});
}
