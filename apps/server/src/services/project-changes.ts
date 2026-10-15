/**
 * «Что изменилось» in «Жизнь проекта»: every version of Akariya leaves a snapshot of its figures, and the
 * figures of the running version are compared with the snapshot of the version installed before it.
 * Only real numbers are compared; figures that move with the clock alone (age, countdowns) never count.
 */
import type { Metric, ProjectStatsData } from "./project-stats.js";

export interface MetricChange { from: number; to: number; before: string }
export interface Snapshot { head: string; at: string; values: Record<string, { n: number; text: string }> }

/** These change every hour without any update, or carry a clock time instead of an amount. */
export const UNSTABLE = new Set(["age", "oldtimer", "birthday", "frozen", "week", "calendar", "hours", "startup", "library"]);
const MAX_SNAPSHOTS = 12;

/** The amount at the start of a figure: «82 556» → 82556, «−1 034» → 1034, «0,6 МБ» → 0.6, «67% ts» → 67. */
export function metricNumber(text: string): number | null {
  const m = /^[+−-]?\s*(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,](\d+))?/u.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(/[\s  ]/gu, "") + (m[2] ? "." + m[2] : ""));
  return Number.isFinite(n) ? n : null;
}

export function snapshotOf(data: Pick<ProjectStatsData, "head" | "metrics">, at = new Date().toISOString()): Snapshot {
  const values: Snapshot["values"] = {};
  for (const m of data.metrics) {
    if (UNSTABLE.has(m.id)) continue;
    const n = metricNumber(m.value);
    if (n !== null) values[m.id] = { n, text: m.value };
  }
  return { head: data.head, at, values };
}

/** Accepts only well-formed snapshots from disk. */
export function cleanSnapshots(raw: unknown): Snapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: Snapshot[] = [];
  for (const s of raw.slice(-MAX_SNAPSHOTS)) {
    if (!s || typeof s !== "object") continue;
    const v = s as Partial<Snapshot>;
    if (typeof v.head !== "string" || !v.head || typeof v.at !== "string" || !v.values || typeof v.values !== "object") continue;
    const values: Snapshot["values"] = {};
    for (const [id, x] of Object.entries(v.values)) {
      if (x && typeof x === "object" && typeof x.n === "number" && Number.isFinite(x.n) && typeof x.text === "string") values[id.slice(0, 40)] = { n: x.n, text: x.text.slice(0, 60) };
    }
    out.push({ head: v.head.slice(0, 40), at: v.at.slice(0, 40), values });
  }
  return out;
}

/**
 * Records the running version once and marks every figure that differs from the previous version.
 * Returns the figures with `change` set and the snapshot list to keep.
 */
export function compareWithPrevious(data: ProjectStatsData, snapshots: Snapshot[], now = new Date().toISOString()):
  { data: ProjectStatsData & { since?: { head: string; at: string } }; snapshots: Snapshot[] } {
  if (!data.head) return { data, snapshots };
  let kept = snapshots;
  if (kept[kept.length - 1]?.head !== data.head) kept = [...kept.filter((s) => s.head !== data.head), snapshotOf(data, now)].slice(-MAX_SNAPSHOTS);
  const previous = [...kept].reverse().find((s) => s.head !== data.head);
  if (!previous) return { data, snapshots: kept };
  const metrics: (Metric & { change?: MetricChange })[] = data.metrics.map((m) => {
    if (UNSTABLE.has(m.id)) return m;
    const before = previous.values[m.id], to = metricNumber(m.value);
    if (!before || to === null || before.n === to) return m;
    return { ...m, change: { from: before.n, to, before: before.text } };
  });
  return { data: { ...data, metrics, since: { head: previous.head, at: previous.at } }, snapshots: kept };
}
