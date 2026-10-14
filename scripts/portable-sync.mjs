import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotPortableFiles } from "./portable-transfer.mjs";

function assertDisjoint(a, b) {
  const relative = path.relative(a, b), reverse = path.relative(b, a);
  const inside = r => r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r));
  if (inside(relative) || inside(reverse)) throw Error("Source and destination must not overlap");
}
export async function planPortableSync(source, destination) {
  const from = path.resolve(source), to = path.resolve(destination);
  assertDisjoint(from, to);
  const [left, right] = await Promise.all([snapshotPortableFiles(from), snapshotPortableFiles(to)]);
  const additions = Object.keys(left).filter(name => !(name in right)).sort();
  const conflicts = Object.keys(left).filter(name => name in right && left[name] !== right[name]).sort();
  const destinationOnly = Object.keys(right).filter(name => !(name in left)).sort();
  return { sourceFiles: Object.keys(left).length, destinationFiles: Object.keys(right).length,
    additions, conflicts, destinationOnly, safeToAdd: conflicts.length === 0 };
}
// Additive-only: never remove or replace anything in the destination.
// Caller must have stopped both running applications before invoking.
export async function syncPortableAdditions(source, destination, { acknowledgeStopped = false } = {}) {
  if (!acknowledgeStopped) throw Error("Explicit confirmation that both copies are stopped is required");
  const from = path.resolve(source), to = path.resolve(destination);
  const plan = await planPortableSync(from, to);
  if (plan.conflicts.length) throw Error("Conflicting modified files: synchronize manually before copying");
  // Snapshot just before writing to detect source changes.
  const expected = await snapshotPortableFiles(from);
  const written = [];
  try {
    for (const name of plan.additions) {
      const segments = name.split("/");
      const src = path.join(from, ...segments);
      const dst = path.join(to, ...segments);
      await mkdir(path.dirname(dst), { recursive: true });
      // Exclusivity guarantees no existing destination file can be overwritten.
      await copyFile(src, dst, constants.COPYFILE_EXCL);
      written.push(dst);
      const actual = await snapshotPortableFiles(to);
      if (actual[name] !== expected[name]) throw Error("Copied file failed SHA-256 verification");
    }
    const post = await snapshotPortableFiles(from);
    if (JSON.stringify(expected) !== JSON.stringify(post)) throw Error("Source changed during synchronization");
    return {added: written.length, verified: true, conflicts: []};
  } catch (error) {
    // A failed transfer never rolls back potentially modified files: report exact error.
    // Created files are safely additive and can be inspected/reconciled on retry.
    throw Error("Sync interrupted after adding " + written.length + " files: " + error.message);
  }
}
const self = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (self) {
  const [mode, source, destination, confirmation] = process.argv.slice(2);
  if (!["plan", "add"].includes(mode) || !source || !destination) {
    console.error("Usage: node scripts/portable-sync.mjs plan|add <source> <destination> [--both-stopped]");
    process.exitCode = 2;
  } else {
    const task = mode === "plan" ? planPortableSync(source, destination) :
      syncPortableAdditions(source, destination, { acknowledgeStopped: confirmation === "--both-stopped" });
    task.then(result => console.log(JSON.stringify(result,null,2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
