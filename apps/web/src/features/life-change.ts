/**
 * «Что изменилось» inside a tile of «Жизнь проекта»: the old value rolls away like a flip board, a delta badge
 * bursts with sparks, an aurora runs round the tile in the colour of the change (green — better, red — worse,
 * gold — just different) and a before/after bar shows the size of the step.
 */
import { el } from "./life-charts.js";

export interface MetricChange { from: number; to: number; before: string }
export type ChangeTone = "good" | "bad" | "neutral";

/** Figures where more is better, and where less is better; everything else is just «different». */
const GOOD_UP = new Set(["words_added", "files_born", "abilities", "tools", "guards", "experiments", "pages", "endpoints", "russian_ui",
  "tests", "test_share", "test_files", "catches", "comments", "docs", "rare", "book", "update_success", "streak", "integrity",
  "types", "russian_commits", "ancient", "download", "cleanup"]);
const GOOD_DOWN = new Set(["any", "todo", "urgent", "giant", "avg_file", "longest_line", "downtime", "deps", "longest_name"]);

export function changeTone(id: string, change: MetricChange): ChangeTone {
  const up = change.to > change.from;
  if (GOOD_UP.has(id)) return up ? "good" : "bad";
  if (GOOD_DOWN.has(id)) return up ? "bad" : "good";
  return "neutral";
}

const number = (n: number): string => n.toLocaleString("ru-RU", { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 });
/** «+9», «−2», «+0,4» and the relative step «+9,6%» («новое» when it grew from zero). */
export function changeText(change: MetricChange): { delta: string; percent: string } {
  const diff = change.to - change.from;
  const delta = (diff > 0 ? "+" : "−") + number(Math.abs(Math.round(diff * 10) / 10));
  if (change.from === 0) return { delta, percent: "новое" };
  const pct = Math.round((diff / Math.abs(change.from)) * 1000) / 10;
  return { delta, percent: (pct > 0 ? "+" : "−") + Math.abs(pct).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%" };
}

const SVG = "http://www.w3.org/2000/svg";
function arrow(up: boolean): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 12 12"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", up ? "M6 10V2M2.5 5.5 6 2l3.5 3.5" : "M6 2v8M2.5 6.5 6 10l3.5-3.5");
  s.append(p);
  return s;
}

/** The flip board shows the old value first and rolls to the new one when the tile is first seen. */
const player = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries, observer) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("play"); observer.unobserve(e.target); }
    }, { threshold: 0.6 })
  : null;

/** Turns a tile into a «changed» tile. Returns the parts to place: the value block, the badge and the comparison. */
export function decorateChange(tile: HTMLElement, id: string, value: string, change: MetricChange, since: string | null):
  { value: HTMLElement; badge: HTMLElement; compare: HTMLElement } {
  const tone = changeTone(id, change);
  const up = change.to > change.from;
  const { delta, percent } = changeText(change);
  tile.classList.add("changed", "tone-" + tone);
  tile.title = `Было ${change.before} → стало ${value} (${percent})` + (since ? ` · по сравнению с версией ${since}` : "");
  tile.append(el("span", { cls: "life-aurora", attrs: { "aria-hidden": "true" } }));

  const board = el("div", { cls: "life-value life-flip" },
    el("span", { cls: "life-flip-old", textContent: change.before, attrs: { "aria-hidden": "true" } }),
    el("span", { cls: "life-flip-new", textContent: value }));

  const badge = el("span", { cls: "life-delta" + (up ? " up" : " down"), attrs: { role: "img", "aria-label": `Изменение: ${delta} (${percent})` } },
    arrow(up), el("b", { textContent: delta }), el("small", { textContent: percent }));
  for (let k = 0; k < 8; k++) {
    const spark = el("i", { cls: "life-spark" });
    spark.style.setProperty("--a", k * 45 + "deg");
    badge.append(spark);
  }

  const max = Math.max(Math.abs(change.from), Math.abs(change.to)) || 1;
  const bar = el("span", { cls: "life-shift-bar", attrs: { "aria-hidden": "true" } },
    el("span", { cls: "life-shift-old" }), el("span", { cls: "life-shift-new" }), el("span", { cls: "life-shift-mark" }));
  bar.style.setProperty("--old", (Math.abs(change.from) / max * 100).toFixed(1) + "%");
  bar.style.setProperty("--new", (Math.abs(change.to) / max * 100).toFixed(1) + "%");
  const compare = el("div", { cls: "life-shift" }, el("span", { cls: "life-shift-text" }, "было ", el("s", { textContent: change.before })), bar);

  if (player) player.observe(tile); else tile.classList.add("play");
  return { value: board, badge, compare };
}
