/**
 * Figures of «Жизнь проекта» that only the running Akariya knows: the updater's local journal and telemetry
 * (.runtime/github-updater), its backups, the start-up times of this install and the assistant's memory.
 * Every value comes from a real record; without one the tile keeps its «—».
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeFigures } from "./project-stats.js";

const MAX_JOURNAL = 1024 * 1024;
const fmt = (n: number, digits = 0): string => n.toLocaleString("ru-RU", { maximumFractionDigits: digits });
const plural = (n: number, [one, few, many]: [string, string, string]): string => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};
const ring = (a: number, b: number): number => (b > 0 ? Math.round(1000 * Math.min(1, Math.max(0, a / b))) / 1000 : 0);

/** JSON lines of a small regular file; a missing, linked or oversized journal yields nothing. */
async function journal(file: string, keep: number): Promise<Record<string, unknown>[]> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JOURNAL) return [];
    const rows: Record<string, unknown>[] = [];
    for (const line of (await readFile(file, "utf8")).split("\n").slice(-keep)) {
      try { const v: unknown = JSON.parse(line); if (v && typeof v === "object") rows.push(v as Record<string, unknown>); } catch { /* corrupt line */ }
    }
    return rows;
  } catch { return []; }
}

async function folderSize(dir: string, depth = 0): Promise<{ bytes: number; files: number }> {
  const total = { bytes: 0, files: 0 };
  if (depth > 9) return total;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return total; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const sub = await folderSize(p, depth + 1); total.bytes += sub.bytes; total.files += sub.files; }
    else if (e.isFile()) { try { total.bytes += (await lstat(p)).size; total.files++; } catch { /* vanished */ } }
  }
  return total;
}

/** The memory store lists at most this many records at once; reaching it is shown as «128+». */
export const MEMORY_LIST_CAP = 128;
const seconds = (ms: number): string => (ms < 1000 ? fmt(ms) + " мс" : fmt(ms / 1000, 1) + " с");

export interface UpdaterFigureSources {
  root: string;
  /** Start-up times of the recent runs, oldest first, in milliseconds. */
  startups?: () => number[];
  /** Number of long-term memory records of the assistant. */
  memories?: () => Promise<number>;
}

export async function updaterFigures(src: UpdaterFigureSources): Promise<RuntimeFigures> {
  const out: RuntimeFigures = {};
  const dir = path.join(src.root, ".runtime", "github-updater");

  const history = await journal(path.join(dir, "history.jsonl"), 5000);
  const prepared = history.filter((e) => e.event === "prepared").length;
  const confirmed = history.filter((e) => e.event === "confirmed").length;
  const rolledBack = history.filter((e) => e.event === "rolled_back").length;
  if (prepared > 0)
    out.update_success = { value: Math.round((100 * Math.min(confirmed, prepared)) / prepared) + "%", detail: `${confirmed} из ${prepared} установок подтверждены`, ring: ring(confirmed, prepared) };
  if (history.length)
    out.rescued = { value: fmt(rolledBack), detail: rolledBack ? `${plural(rolledBack, ["откат вернул", "отката вернули", "откатов вернули"])} рабочую версию` : "откатывать ещё не приходилось", kind: "dots", series: [rolledBack] };

  const telemetry = await journal(path.join(dir, "telemetry.jsonl"), 4000);
  const speeds: number[] = [], downtimes: number[] = [];
  let stoppedAt: number | null = null;
  for (const v of telemetry) {
    const at = typeof v.at === "string" ? Date.parse(v.at) : NaN;
    if (v.event === "backend_stopped" && Number.isFinite(at)) stoppedAt = at;
    if (v.event === "http_recovered" && Number.isFinite(at) && stoppedAt !== null && at >= stoppedAt && at - stoppedAt < 3_600_000) {
      downtimes.push(Math.round((at - stoppedAt) / 100) / 10);
      stoppedAt = null;
    }
    const ms = v.durationMs, bytes = v.bytes;
    if (v.event === "download_complete" && typeof ms === "number" && ms > 0 && ms < 86_400_000 && typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0)
      speeds.push(Math.round((bytes / 1048576 / (ms / 1000)) * 100) / 100);
  }
  if (speeds.length)
    out.download = { value: fmt(speeds[speeds.length - 1]!, 2) + " МиБ/с", detail: `загрузок измерено: ${speeds.length}`, kind: "line", series: speeds.slice(-12) };
  if (downtimes.length)
    out.downtime = { value: fmt(downtimes[downtimes.length - 1]!, 1) + " с", detail: "от остановки сервера до первого ответа", kind: "spark", series: downtimes.slice(-12) };

  const backups = await folderSize(path.join(dir, "backups"));
  out.backups = { value: fmt(backups.bytes / 1048576, 1) + " МБ", detail: backups.files ? `${fmt(backups.files)} ${plural(backups.files, ["файл", "файла", "файлов"])} для отката` : "копий пока нет" };

  const startups = src.startups?.() ?? [];
  if (startups.length) {
    const last = startups[startups.length - 1]!, first = startups[0]!;
    out.startup = {
      value: seconds(last),
      detail: startups.length > 1 ? `${last <= first ? "быстрее" : "медленнее"} первого замера (${seconds(first)})` : "первый замер",
      kind: "spark", series: startups
    };
  }
  if (src.memories) {
    try { const n = await src.memories(); out.library = { value: fmt(n) + (n >= MEMORY_LIST_CAP ? "+" : ""), detail: "записей сохранено по вашей просьбе", kind: "dots", series: [n] }; }
    catch { /* memory store unavailable */ }
  }
  return out;
}
