/**
 * «Жизнь проекта» on the updates page (ported from JUUNIBI): figures about Akariya's history, each with a small chart.
 * A git checkout counts them itself (scripts/project-stats.mjs); an install from an archive has no history and
 * reads what GitHub Actions published to the `stats` branch. Figures only the running app knows (updater
 * telemetry, rollbacks, start-up time, memory) are filled in on top.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@akariya/core";
import { cleanSnapshots, compareWithPrevious, type MetricChange, type Snapshot } from "./project-changes.js";

export const STATS_URL = "https://raw.githubusercontent.com/Aspksa/AkariyaTenka/stats/project-stats.json";
const LOCAL_TTL = 10 * 60_000, REMOTE_TTL = 60 * 60_000;
const SHA = /^[0-9a-f]{40}$/;

export interface Metric {
  id: string; group: string; emoji: string; title: string; hint: string; value: string; detail: string;
  kind?: ChartKind; series?: number[]; list?: string[];
  /** Names of the bars or parts of the chart (shown on hover and under a split bar). */
  labels?: string[];
  /** A share from 0 to 1, drawn as a ring next to the value. */
  ring?: number;
  /** Set when the figure differs from the version installed before this one. */
  change?: MetricChange;
}
export const CHART_KINDS = ["hours", "calendar", "spark", "list", "line", "split", "dots", "swatches"] as const;
export type ChartKind = typeof CHART_KINDS[number];
export interface ProjectStatsData {
  version: 1; generatedAt: string; head: string; commits: number;
  groups: { id: string; title: string }[]; metrics: Metric[];
  /** Where the figures came from: this checkout, GitHub, or the copy saved after the last successful download. */
  source?: "git" | "github" | "saved";
  /** The version the changes are counted from. */
  since?: { head: string; at: string };
}
export type RuntimeFigures = Record<string, { value: string; detail?: string } & Pick<Metric, "kind" | "series" | "labels" | "ring">>;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
/** Accepts only the expected shape; anything else from the network is dropped. */
export function cleanStats(raw: unknown): ProjectStatsData | null {
  const r = raw as Partial<ProjectStatsData> | null;
  if (!r || r.version !== 1 || !Array.isArray(r.metrics) || !Array.isArray(r.groups) || r.metrics.length > 100 || r.groups.length > 20) return null;
  const metrics: Metric[] = [];
  for (const m of r.metrics as unknown[]) {
    const x = m as Partial<Metric>;
    if (!x || typeof x.id !== "string" || typeof x.group !== "string") continue;
    const kind = (CHART_KINDS as readonly unknown[]).includes(x.kind) ? x.kind : undefined;
    metrics.push({
      id: str(x.id, 40), group: str(x.group, 40), emoji: str(x.emoji, 8), title: str(x.title, 80), hint: str(x.hint, 120),
      value: str(x.value, 60), detail: str(x.detail, 200),
      ...(kind ? { kind } : {}),
      ...(Array.isArray(x.series) ? { series: x.series.slice(0, 60).map((n) => (Number.isFinite(n) ? Number(n) : 0)) } : {}),
      ...(Array.isArray(x.list) ? { list: x.list.slice(0, 24).map((s) => str(s, 160)) } : {}),
      ...(Array.isArray(x.labels) ? { labels: x.labels.slice(0, 60).map((s) => str(s, 60)) } : {}),
      ...(typeof x.ring === "number" && Number.isFinite(x.ring) ? { ring: Math.min(1, Math.max(0, x.ring)) } : {})
    });
  }
  return {
    version: 1, generatedAt: str(r.generatedAt, 40), head: str(r.head, 40), commits: Number.isFinite(r.commits) ? Number(r.commits) : 0,
    groups: (r.groups as unknown[]).map((g) => ({ id: str((g as { id?: unknown }).id, 40), title: str((g as { title?: unknown }).title, 80) })),
    metrics
  };
}

export class ProjectStats {
  private cache: { at: number; data: ProjectStatsData; local: boolean } | null = null;
  private pending: Promise<ProjectStatsData> | null = null;
  constructor(private readonly root: string, private readonly dataDir: string,
    private readonly runtime: () => Promise<RuntimeFigures> = async () => ({}),
    private readonly fetchImpl: typeof fetch = fetch) {}

  private get saved(): string { return path.join(this.dataDir, "project-stats.json"); }

  /** The version the updater installed (`.akariya-version`), or null for a plain checkout. */
  private async installed(): Promise<string | null> {
    try { const v = (await readFile(path.join(this.root, ".akariya-version"), "utf8")).trim().toLowerCase(); return SHA.test(v) ? v : null; }
    catch { return null; }
  }
  private gitHead(): Promise<string | null> {
    return new Promise((resolve) => execFile("git", ["-C", this.root, "rev-parse", "HEAD"], { timeout: 5000, windowsHide: true },
      (err, out) => resolve(err ? null : (SHA.test(out.trim()) ? out.trim().toLowerCase() : null))));
  }
  /**
   * The local history counts only when it is the version that runs. The updater never touches `.git`, so a
   * folder that started as a clone keeps the history of its first version: then GitHub's figures are the true ones.
   */
  private async useLocalHistory(installed: string | null): Promise<boolean> {
    if (!existsSync(path.join(this.root, ".git"))) return false;
    return installed === null || installed === await this.gitHead();
  }

  async get(force = false): Promise<ProjectStatsData> {
    const installed = await this.installed();
    const local = await this.useLocalHistory(installed);
    if (!force && this.cache && this.cache.local === local && Date.now() - this.cache.at < (local ? LOCAL_TTL : REMOTE_TTL)) return this.withRuntime(this.cache.data, installed);
    this.pending ??= (local ? this.fromGit() : this.fromGitHub()).finally(() => { this.pending = null; });
    const data = await this.pending;
    this.cache = { at: Date.now(), data, local };
    return this.withRuntime(data, installed);
  }

  private async withRuntime(data: ProjectStatsData, installed: string | null): Promise<ProjectStatsData> {
    let extra: RuntimeFigures = {};
    try { extra = await this.runtime(); } catch { /* the figures from history are still worth showing */ }
    const merged = { ...data, metrics: data.metrics.map((m) => (extra[m.id] ? { ...m, ...extra[m.id], detail: extra[m.id]!.detail ?? m.detail } : m)) };
    // versions are told apart by what is installed; the figures' own head may lag behind or run ahead of it
    return this.withChanges(installed ? { ...merged, head: installed } : merged);
  }

  private get snapshotsFile(): string { return path.join(this.dataDir, "project-stats-snapshots.json"); }
  private snapshotQueue: Promise<unknown> = Promise.resolve();
  /** Marks what changed since the previous version; the figures still show when the snapshot file can't be used. */
  private withChanges(data: ProjectStatsData): Promise<ProjectStatsData> {
    const task = this.snapshotQueue.then(async () => {
      let snapshots: Snapshot[] = [];
      try { snapshots = cleanSnapshots(JSON.parse(await readFile(this.snapshotsFile, "utf8"))); } catch { /* first version */ }
      const result = compareWithPrevious(data, snapshots);
      if (result.snapshots !== snapshots) {
        try {
          await mkdir(this.dataDir, { recursive: true });
          await writeFile(this.snapshotsFile + ".tmp", JSON.stringify(result.snapshots));
          await rename(this.snapshotsFile + ".tmp", this.snapshotsFile);
        } catch { /* read-only folder: compared, just not remembered */ }
      }
      return result.data;
    });
    this.snapshotQueue = task.catch(() => undefined);
    return task.catch(() => data);
  }

  private fromGit(): Promise<ProjectStatsData> {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [path.join(this.root, "scripts", "project-stats.mjs")],
        { cwd: this.root, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, out) => {
          const data = err ? null : (() => { try { return cleanStats(JSON.parse(out)); } catch { return null; } })();
          if (data) resolve({ ...data, source: "git" });
          else this.fromGitHub().then(resolve, reject);
        });
    });
  }

  private async fromGitHub(): Promise<ProjectStatsData> {
    try {
      const r = await this.fetchImpl(STATS_URL + "?t=" + Math.floor(Date.now() / REMOTE_TTL), { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const data = cleanStats(await r.json());
      if (!data) throw new Error("bad data");
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(this.saved + ".tmp", JSON.stringify(data));
      await rename(this.saved + ".tmp", this.saved);
      return { ...data, source: "github" };
    } catch {
      try {
        const data = cleanStats(JSON.parse(await readFile(this.saved, "utf8")));
        if (data) return { ...data, source: "saved" };
      } catch { /* nothing saved yet */ }
      throw new AppError({ code: "EXTERNAL_SERVICE", message: "Показатели пока недоступны: GitHub не ответил, а сохранённой копии ещё нет. Они появятся, когда будет связь с GitHub." });
    }
  }
}

/** Start-up time of this run next to the previous ones (kept in data/startup-times.json, last 10). */
export async function recordStartup(dataDir: string, ms: number): Promise<number[]> {
  const file = path.join(dataDir, "startup-times.json");
  let list: number[] = [];
  try { const raw: unknown = JSON.parse(await readFile(file, "utf8")); if (Array.isArray(raw)) list = raw.filter((n): n is number => Number.isFinite(n)).slice(-9); } catch { /* first run */ }
  list.push(Math.round(ms));
  try { await mkdir(dataDir, { recursive: true }); await writeFile(file, JSON.stringify(list)); } catch { /* read-only folder: still shown for this run */ }
  return list;
}
