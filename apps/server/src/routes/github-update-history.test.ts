import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { githubUpdateHistory } from "./github-update-history.js";

describe("GitHub update history", () => {
  it("returns safe, newest-first events without leaking malformed records", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akariya-history-"));
    try {
      const folder = path.join(root, ".runtime", "github-updater");
      await mkdir(folder, { recursive: true });
      const sha = "a".repeat(40);
      await writeFile(path.join(folder, "history.jsonl"), [
        JSON.stringify({ at: "2026-10-14T00:00:00Z", event: "validated", revision: sha }),
        "{broken",
        JSON.stringify({ at: "2026-10-14T00:01:00Z", event: "confirmed", revision: sha }),
        JSON.stringify({ at: "2026-10-14T00:02:00Z", event: "wrong", revision: sha })
      ].join("\n"));
      const result = await githubUpdateHistory(root);
      expect(result.events).toHaveLength(2);
      expect(result.events.map(e => e.event)).toEqual(["confirmed", "validated"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
