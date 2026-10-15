import { mkdtemp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanSnapshots, compareWithPrevious, metricNumber, snapshotOf } from "./project-changes.js";
import { ProjectStats, type ProjectStatsData } from "./project-stats.js";

const metric = (id: string, value: string) => ({ id, group: "care", emoji: "🔍", title: id, hint: "", value, detail: "" });
const stats = (head: string, values: Record<string, string>): ProjectStatsData => ({
  version: 1, generatedAt: "2026-10-15T00:00:00Z", head, commits: 1, groups: [{ id: "care", title: "Надёжность" }],
  metrics: Object.entries(values).map(([id, v]) => metric(id, v))
});

describe("что изменилось после обновления", () => {
  it("reads the amount at the start of a figure", () => {
    expect(metricNumber("82 556")).toBe(82556);
    expect(metricNumber("−1 034")).toBe(1034);
    expect(metricNumber("+702")).toBe(702);
    expect(metricNumber("0,6 МБ")).toBe(0.6);
    expect(metricNumber("67% ts")).toBe(67);
    expect(metricNumber("6 из 10")).toBe(6);
    expect(metricNumber("—")).toBeNull();
    expect(metricNumber("chore — 65")).toBeNull();
  });
  it("leaves out figures that move with the clock alone", () => {
    expect(Object.keys(snapshotOf(stats("a", { tests: "94", age: "12 ч", fav_word: "chore — 3" })).values)).toEqual(["tests"]);
  });
  it("marks changes against the version installed before", () => {
    const first = compareWithPrevious(stats("a", { tests: "94", any: "2", docs: "489 строк" }), [], "t1");
    expect(first.snapshots).toHaveLength(1);
    expect(first.data.metrics.some((m) => "change" in m)).toBe(false);
    const second = compareWithPrevious(stats("b", { tests: "103", any: "0", docs: "489 строк" }), first.snapshots, "t2");
    const by = new Map(second.data.metrics.map((m) => [m.id, m]));
    expect(by.get("tests")!.change).toEqual({ from: 94, to: 103, before: "94" });
    expect(by.get("any")!.change).toEqual({ from: 2, to: 0, before: "2" });
    expect(by.get("docs")!.change).toBeUndefined();
    expect(second.data.since).toEqual({ head: "a", at: "t1" });
    // the same version again keeps comparing with «a» and does not add a snapshot
    const again = compareWithPrevious(stats("b", { tests: "110" }), second.snapshots, "t3");
    expect(again.snapshots).toBe(second.snapshots);
    expect(again.data.metrics[0]!.change).toEqual({ from: 94, to: 110, before: "94" });
  });
  it("drops malformed snapshots", () => {
    expect(cleanSnapshots([{ head: "a", at: "t", values: { x: { n: 1, text: "1" }, y: { n: "2", text: "2" } } }, null, { head: 5 }]))
      .toEqual([{ head: "a", at: "t", values: { x: { n: 1, text: "1" } } }]);
    expect(cleanSnapshots("nope")).toEqual([]);
  });
  it("remembers versions on disk between runs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "akariya-changes-"));
    let current = stats("a", { tests: "94" });
    const fetchStats = (async () => new Response(JSON.stringify(current))) as unknown as typeof fetch;
    expect((await new ProjectStats(dir, path.join(dir, "data"), undefined, fetchStats).get()).since).toBeUndefined();
    current = stats("b", { tests: "103" });
    const after = await new ProjectStats(dir, path.join(dir, "data"), undefined, fetchStats).get();
    expect(after.since?.head).toBe("a");
    expect(after.metrics[0]!.change).toMatchObject({ from: 94, to: 103 });
  });
  it("compares installed versions even when the folder started as a git clone", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "akariya-clone-"));
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "-c", "user.name=Fox", "-c", "user.email=fox@example.invalid", "commit", "-q", "--allow-empty", "-m", "first"]);
    let current = stats("stats-head", { tests: "94" });
    let calls = 0;
    const github = (async () => { calls++; return new Response(JSON.stringify(current)); }) as unknown as typeof fetch;
    const one = "1".repeat(40), two = "2".repeat(40);
    await writeFile(path.join(dir, ".akariya-version"), one + "\n");
    const first = await new ProjectStats(dir, path.join(dir, "data"), undefined, github).get();
    expect(first.source).toBe("github"); // the stale clone history is not used
    expect(first.head).toBe(one);
    current = stats("stats-head-2", { tests: "103" });
    await writeFile(path.join(dir, ".akariya-version"), two + "\n");
    const second = await new ProjectStats(dir, path.join(dir, "data"), undefined, github).get();
    expect(second.since?.head).toBe(one);
    expect(second.metrics[0]!.change).toMatchObject({ from: 94, to: 103 });
    expect(calls).toBe(2);
  });
});

