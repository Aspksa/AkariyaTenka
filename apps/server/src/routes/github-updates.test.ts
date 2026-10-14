import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { currentRevision, githubUpdateStatus } from "./github-updates.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
describe("GitHub update check", () => {
  it("compares a local version marker with a valid official response", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akariya-updates-"));
    try {
      await writeFile(path.join(root, ".akariya-version"), A + "\n");
      const request = async () => new Response(JSON.stringify({ sha: B }), { status: 200 });
      const status = await githubUpdateStatus(root, request as typeof fetch);
      expect(status.current).toBe(A);
      expect(status.latest).toBe(B);
      expect(status.updateAvailable).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects invalid GitHub revision rather than trusting arbitrary data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akariya-updates-"));
    try {
      const request = async () => new Response(JSON.stringify({ sha: "../../bad" }), { status: 200 });
      await expect(githubUpdateStatus(root, request as typeof fetch)).rejects.toThrow("invalid revision");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("does not misclassify an unversioned folder as outdated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akariya-updates-"));
    try {
      expect(await currentRevision(root)).toBeNull();
      const request = async () => new Response(JSON.stringify({ sha: A }), { status: 200 });
      expect((await githubUpdateStatus(root, request as typeof fetch)).updateAvailable).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
