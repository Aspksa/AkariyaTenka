import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, lstat, readFile, copyFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OMIT = new Set(["node_modules", ".git", ".portable-transfer.lock", ".portable-state"]);
const PRIVATE_SUBTREES = new Set(["keys/private", "keys/secrets", ".keys/private", ".keys/secrets"]);
const FORBIDDEN = new Set(["publisher-private.pem", "AKARIYA_RELEASE_SIGNING_KEY_PEM"]);
function nested(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
async function files(root, dir = root, list = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (OMIT.has(entry.name)) continue;
    const relativeName = path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/");
    if (PRIVATE_SUBTREES.has(relativeName)) continue;
    if (FORBIDDEN.has(entry.name)) throw Error("Publisher private signing material must not be transferred");
    const full = path.join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw Error("Unsupported filesystem entry: " + path.relative(root, full));
    }
    if (info.isDirectory()) await files(root, full, list);
    else list.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return list.sort();
}
export async function snapshotPortableFiles(root) {
  const result = {};
  for (const name of await files(root)) {
    const bytes = await readFile(path.join(root, ...name.split("/")));
    result[name] = createHash("sha256").update(bytes).digest("hex");
  }
  return result;
}
export async function inspectPortableCopy(source, target) {
  const from = path.resolve(source), to = path.resolve(target);
  if (nested(from, to) || nested(to, from)) throw Error("Source and destination must not overlap");
  const src = await snapshotPortableFiles(from);
  let dst = null;
  try { await stat(to); dst = await snapshotPortableFiles(to); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const sourceOnly = [], targetOnly = [], changed = [];
  if (dst) {
    for (const name of Object.keys(src)) {
      if (!(name in dst)) sourceOnly.push(name);
      else if (src[name] !== dst[name]) changed.push(name);
    }
    for (const name of Object.keys(dst)) if (!(name in src)) targetOnly.push(name);
  }
  return { sourceFiles: Object.keys(src).length, destinationExists: dst !== null,
    identical: dst !== null && sourceOnly.length === 0 && targetOnly.length === 0 && changed.length === 0,
    sourceOnly, targetOnly, changed };
}
export async function transferPortableCopy(source, target) {
  const from = path.resolve(source), to = path.resolve(target);
  if (nested(from, to) || nested(to, from)) throw Error("Source and destination must not overlap");
  const existing = await stat(to).then(() => true).catch(e => { if (e.code === "ENOENT") return false; throw e; });
  if (existing) throw Error("Destination already exists. Refusing to overwrite: compare first and resolve conflicts.");
  const expected = await snapshotPortableFiles(from);
  const stage = path.join(path.dirname(to), "." + path.basename(to) + ".stage-" + randomUUID());
  await mkdir(stage, { recursive: false });
  try {
    for (const name of Object.keys(expected)) {
      const relative = name.split("/");
      const output = path.join(stage, ...relative);
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(path.join(from, ...relative), output);
    }
    const actual = await snapshotPortableFiles(stage);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error("Transfer verification failed: source changed or destination corrupted");
    await rename(stage, to);
    return { transferred: Object.keys(expected).length, verified: true, destination: to };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

const self = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (self) {
  const [command, source, target] = process.argv.slice(2);
  if (!["compare", "copy"].includes(command) || !source || !target) {
    console.error("Usage: node scripts/portable-transfer.mjs compare|copy <source> <destination>");
    process.exitCode = 2;
  } else {
    (command === "compare" ? inspectPortableCopy(source, target) : transferPortableCopy(source, target))
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
