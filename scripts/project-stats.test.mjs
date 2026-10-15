import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeStats } from "./project-stats.mjs";

test("project stats count real figures from a git history", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "akariya-life-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "Fox", GIT_AUTHOR_EMAIL: "fox@example.invalid", GIT_COMMITTER_NAME: "Fox", GIT_COMMITTER_EMAIL: "fox@example.invalid" };
  const git = (args, date) => execFileSync("git", ["-C", root, ...args], { env: { ...env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }, stdio: "ignore" });
  try {
    git(["init", "-q", "-b", "main"]);
    mkdirSync(path.join(root, "apps", "server", "src"), { recursive: true });
    writeFileSync(path.join(root, "apps", "server", "src", "main.ts"), "export function start() {\n  return 1;\n}\n");
    writeFileSync(path.join(root, "README.md"), "# Fox\n");
    git(["add", "."]); git(["commit", "-qm", "Первый запуск"], "2026-01-05T10:00:00Z");
    writeFileSync(path.join(root, "apps", "server", "src", "main.ts"), "// entry\nexport function start() {\n  return 2;\n}\n");
    git(["commit", "-qam", "fix: исправлена ошибка старта (#2)"], "2026-01-06T02:00:00Z");
    const stats = await computeStats(root, Date.parse("2026-01-07T12:00:00Z"));
    const by = new Map(stats.metrics.map((m) => [m.id, m]));
    assert.equal(stats.version, 1);
    assert.equal(stats.commits, 2);
    assert.equal(stats.groups.length, 6);
    assert.equal(by.get("files_born").value, "2");
    assert.equal(by.get("streak").value, "2 дня");
    assert.equal(by.get("night").value, "1");
    assert.equal(by.get("bugs").value, "1");
    assert.equal(by.get("experiments").value, "1");
    assert.equal(by.get("russian_commits").value, "100%");
    assert.equal(by.get("hours").series.length, 24);
    assert.equal(by.get("rescued").value, "—");
    for (const m of stats.metrics) assert.ok(m.id && m.group && m.title && typeof m.value === "string", m.id);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
