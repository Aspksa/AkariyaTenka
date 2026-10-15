import { createIcon, isIconName, type IconName } from "../components/icons.js";

/** Shape of GET /api/updates/statistics. Newer fields are optional so an older backend still renders. */
interface HistoryStats {
  available: boolean; reason?: string;
  wordsAdded: number | null; wordsDeleted: number | null; wordsRewritten: number | null;
  newFiles: number | null; deletedFiles: number | null;
  largestFile: { path: string; lines: number } | null;
  smallestCodeFile: { path: string; lines: number } | null;
  oldestUntouchedFile: { path: string; lastChanged: string } | null;
  hottestFile: { path: string; commits: number } | null;
  biggestGrowth: { path: string; netLines: number } | null;
  languages: { extension: string; lines: number }[];
  averageCodeLines: number | null; medianCodeLines: number | null;
  directories: number; averageFilesPerDirectory: number;
  markdownLines: number; jsonFiles: number; jsonBytes: number;
  commits?: number | null; authors?: number | null;
  firstCommitAt?: string | null; lastCommitAt?: string | null;
  activeDays?: number | null; longestStreak?: number | null;
  hours?: number[] | null; weekdays?: number[] | null;
  activity?: { date: string; commits: number }[] | null;
}
interface DeepMetric { label: string; value: string | null; detail: string; icon?: string }
interface DeepStats {
  measuredAt?: string;
  sections?: { id?: string; title: string; metrics: DeepMetric[] }[];
  composition?: { files: number; lines: number; code: number; comments: number; blank: number };
  successRate?: number | null;
  caveats?: string[];
}

const SVG = "http://www.w3.org/2000/svg";
const format = new Intl.NumberFormat("ru-RU");
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const num = (v: number | null | undefined): string => typeof v === "number" && Number.isFinite(v) ? format.format(v) : "—";
const motion = (): boolean => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Distinct hues cycled across tiles so neighbours never share a colour. */
const HUES = [356, 28, 45, 150, 188, 214, 262, 318, 8, 172, 232, 290];
const LANGUAGE_HUES: Record<string, number> = {
  ".ts": 214, ".tsx": 200, ".js": 50, ".mjs": 42, ".cjs": 36, ".css": 280, ".html": 14,
  ".json": 150, ".md": 190, ".ps1": 230, ".bat": 120, ".yml": 340, ".yaml": 340, ".py": 205, ".sh": 100, ".sql": 30
};
let svgIds = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function iconChip(name: IconName, cls = "insight-icon"): HTMLElement {
  const chip = el("span", cls);
  chip.setAttribute("aria-hidden", "true");
  chip.append(createIcon(name));
  return chip;
}

/** Counts up the leading number of a metric string (integers and decimals), leaving dates and hashes untouched. */
export function animatableNumber(value: string): { target: number; decimals: number; separator: string; suffix: string } | null {
  const match = /^(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:([.,])(\d+))?(?=$|[\s%])(.*)$/su.exec(value);
  if (!match) return null;
  const whole = match[1]!.replace(/[\s  ]/gu, "");
  const decimals = match[3]?.length ?? 0;
  const target = Number(whole + (decimals ? "." + match[3] : ""));
  if (!Number.isFinite(target) || target < 0 || target > 1e12) return null;
  return { target, decimals, separator: match[2] ?? ",", suffix: match[4] ?? "" };
}
/** First percentage mentioned in a metric value, e.g. "108 строк (0.9%)" → 0.9. */
export function percentIn(value: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s?%/u.exec(value);
  if (!match) return null;
  const p = Number(match[1]!.replace(",", "."));
  return Number.isFinite(p) && p >= 0 && p <= 100 ? p : null;
}
/** Seven-day buckets of a Monday-aligned daily series. */
export function weeklyTotals(days: { date: string; commits: number }[]): { start: string; commits: number }[] {
  const weeks: { start: string; commits: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    weeks.push({ start: slice[0]!.date, commits: slice.reduce((s, d) => s + d.commits, 0) });
  }
  return weeks;
}
function countUp(node: HTMLElement, value: string, delay: number): void {
  node.textContent = value;
  const parsed = animatableNumber(value);
  if (!parsed || !motion()) return;
  const { target, decimals, separator, suffix } = parsed;
  const render = (v: number): string => decimals
    ? v.toFixed(decimals).replace(".", separator) + suffix
    : format.format(Math.round(v)) + suffix;
  node.textContent = render(0);
  const duration = 1100, startedAt = performance.now() + delay;
  const tick = (now: number): void => {
    if (!node.isConnected) return;
    const t = Math.min(1, Math.max(0, (now - startedAt) / duration));
    node.textContent = t >= 1 ? value : render(target * (1 - Math.pow(1 - t, 4)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Reveal elements once as they scroll into view; everything is visible immediately without IntersectionObserver. */
const revealer = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries, observer) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -6% 0px" })
  : null;
function reveal(node: Element, index: number): void {
  node.classList.add("reveal");
  (node as HTMLElement).style.setProperty("--delay", Math.min(index, 14) * 40 + "ms");
  if (revealer) revealer.observe(node); else node.classList.add("is-visible");
}
/** Cursor-following glow on hover-capable devices. */
function trackGlow(node: HTMLElement): void {
  node.addEventListener("pointermove", (event) => {
    const box = node.getBoundingClientRect();
    node.style.setProperty("--mx", ((event.clientX - box.left) / box.width * 100).toFixed(1) + "%");
    node.style.setProperty("--my", ((event.clientY - box.top) / box.height * 100).toFixed(1) + "%");
  });
}

/* ---------- Mini visuals inside tiles ---------- */

function miniRing(percent: number, hue: number): SVGSVGElement {
  const ring = svg("svg", { viewBox: "0 0 36 36", class: "mini-ring", "aria-hidden": "true" });
  ring.style.setProperty("--hue", String(hue));
  ring.append(svg("circle", { cx: 18, cy: 18, r: 15, class: "mini-ring-track", pathLength: 100 }));
  const arc = svg("circle", { cx: 18, cy: 18, r: 15, class: "mini-ring-arc", pathLength: 100 });
  arc.style.setProperty("--p", Math.max(1.5, percent).toFixed(1));
  ring.append(arc);
  return ring;
}
function miniSpark(values: number[], hue: number): SVGSVGElement {
  const w = 72, h = 26, max = Math.max(1, ...values);
  const spark = svg("svg", { viewBox: `0 0 ${w} ${h}`, class: "mini-spark", preserveAspectRatio: "none", "aria-hidden": "true" });
  spark.style.setProperty("--hue", String(hue));
  const step = w / Math.max(1, values.length);
  values.forEach((v, i) => {
    const bh = Math.max(1.5, v / max * (h - 2));
    const bar = svg("rect", { x: (i * step + step * .18).toFixed(2), y: (h - bh).toFixed(2), width: (step * .64).toFixed(2), height: bh.toFixed(2), rx: 1 });
    bar.style.setProperty("--i", String(i));
    spark.append(bar);
  });
  return spark;
}
function miniStack(parts: { value: number; hue: number }[]): HTMLElement {
  const bar = el("span", "mini-stack");
  bar.setAttribute("aria-hidden", "true");
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  parts.forEach((p, i) => {
    const seg = el("span");
    seg.style.setProperty("--w", (p.value / total * 100).toFixed(2) + "%");
    seg.style.setProperty("--hue", String(p.hue));
    seg.style.setProperty("--i", String(i));
    bar.append(seg);
  });
  return bar;
}

/* ---------- Tiles ---------- */

interface TileSpec {
  icon: IconName; label: string; value: string | null;
  detail?: string | undefined; path?: string | undefined; hue?: number;
  /** 0–1: the value relative to the largest comparable value in its group. */
  share?: number | undefined;
}
function tile(spec: TileSpec, index: number): HTMLElement {
  const hue = spec.hue ?? HUES[index % HUES.length]!;
  const card = el("article", "insight-tile");
  card.style.setProperty("--hue", String(hue));
  const head = el("div", "insight-tile-head");
  head.append(iconChip(spec.icon), el("span", "insight-tile-label", spec.label));
  const percent = spec.value ? percentIn(spec.value) : null;
  if (percent !== null) head.append(miniRing(percent, hue));
  card.append(head);
  if (spec.path) {
    const code = el("code", "insight-path", spec.path);
    code.title = spec.path;
    card.append(code);
  }
  if (spec.detail) {
    const detail = el("small", "insight-tile-detail", spec.detail);
    detail.title = spec.detail;
    card.append(detail);
  }
  // The value always sits in the bottom-right corner; long textual facts get a calmer, wrapping style.
  const value = el("p", "insight-tile-value");
  const text = spec.value ?? "—";
  if (text.length > 16 && !animatableNumber(text)) card.classList.add("is-long");
  else if (text.length > 11) value.classList.add("is-wide");
  countUp(value, text, Math.min(index, 14) * 40);
  value.title = text;
  card.append(value);
  if (spec.share !== undefined) {
    const meter = el("span", "insight-meter");
    meter.setAttribute("aria-hidden", "true");
    meter.style.setProperty("--w", Math.max(2, Math.min(100, spec.share * 100)).toFixed(1) + "%");
    card.append(meter);
  }
  trackGlow(card);
  reveal(card, index);
  return card;
}
/** Adds relative meters to tiles whose values are comparable plain counts. */
function withShares(specs: TileSpec[]): TileSpec[] {
  const values = specs.map(s => s.value ? animatableNumber(s.value)?.target ?? null : null);
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  return specs.map((s, i) => values[i] !== null && max > 0 ? { ...s, share: values[i]! / max } : s);
}
function tileGrid(specs: TileSpec[], offset = 0): HTMLElement {
  const wrap = el("div", "insight-grid");
  wrap.append(...specs.map((s, i) => tile(s, i + offset)));
  return wrap;
}
/** Metrics without a value are listed compactly instead of occupying full tiles. */
function pending(metrics: DeepMetric[]): HTMLElement | null {
  if (!metrics.length) return null;
  const row = el("div", "insight-pending");
  row.append(el("span", "insight-pending-title", "Пока не измеряется"));
  for (const m of metrics) {
    const chip = el("span", "insight-pending-chip");
    chip.append(createIcon(isIconName(m.icon) ? m.icon : "info"), el("span", undefined, m.label));
    chip.title = m.detail;
    row.append(chip);
  }
  return row;
}

/* ---------- Chart cards ---------- */

function card(icon: IconName, title: string, subtitle: string, span: "s" | "m" | "l" | "xl", ...body: (HTMLElement | SVGElement)[]): HTMLElement {
  const box = el("section", "insight-card span-" + span);
  const head = el("header", "insight-card-head");
  const text = el("div");
  text.append(el("h4", undefined, title), el("p", undefined, subtitle));
  head.append(iconChip(icon, "insight-card-icon"), text);
  box.append(head, ...body);
  reveal(box, 0);
  return box;
}

/** Weekly histogram with a smooth trend line drawn over it. */
function weeklyChart(days: { date: string; commits: number }[]): HTMLElement {
  const weeks = weeklyTotals(days);
  const wrap = el("div", "trend");
  const w = 520, h = 150, pad = 8, max = Math.max(1, ...weeks.map(x => x.commits));
  const chart = svg("svg", { viewBox: `0 0 ${w} ${h}`, class: "trend-svg", role: "img",
    "aria-label": "Коммиты по неделям: " + weeks.map(x => x.commits).join(", ") });
  const id = "trend-" + ++svgIds;
  const defs = svg("defs");
  const grad = svg("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svg("stop", { offset: "0%", "stop-color": "hsl(356 90% 62%)", "stop-opacity": ".45" }),
    svg("stop", { offset: "100%", "stop-color": "hsl(356 90% 62%)", "stop-opacity": "0" }));
  defs.append(grad);
  chart.append(defs);
  for (let g = 1; g <= 3; g++) chart.append(svg("line", { x1: 0, x2: w, y1: (h - pad) * g / 4, y2: (h - pad) * g / 4, class: "trend-grid" }));
  const step = w / weeks.length;
  const points = weeks.map((x, i) => [i * step + step / 2, h - pad - x.commits / max * (h - pad * 3)] as const);
  weeks.forEach((x, i) => {
    const bh = Math.max(2, x.commits / max * (h - pad * 3));
    const bar = svg("rect", { x: (i * step + step * .2).toFixed(1), y: (h - pad - bh).toFixed(1), width: (step * .6).toFixed(1), height: bh.toFixed(1), rx: 3, class: "trend-bar" });
    bar.style.setProperty("--i", String(i));
    bar.style.setProperty("--hue", String(Math.round(214 + (356 - 214) * x.commits / max)));
    const tip = svg("title");
    tip.textContent = "Неделя с " + new Date(x.start + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ": " + num(x.commits);
    bar.append(tip);
    chart.append(bar);
  });
  // Catmull-Rom → cubic Bézier for a soft line through every weekly point.
  let d = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
    // Clamp control points so the curve never dips below the baseline or above the peak.
    const clampY = (y: number): number => Math.min(h - pad, Math.max(pad * 2, y));
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clampY(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clampY(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const last = points[points.length - 1]!, first = points[0]!;
  chart.append(svg("path", { d: `${d} L${last[0].toFixed(1)} ${h - pad} L${first[0].toFixed(1)} ${h - pad} Z`, fill: `url(#${id})`, class: "trend-area" }));
  chart.append(svg("path", { d, class: "trend-line", pathLength: 100 }));
  const peak = weeks.reduce((best, x, i) => x.commits > weeks[best]!.commits ? i : best, 0);
  chart.append(svg("circle", { cx: points[peak]![0].toFixed(1), cy: points[peak]![1].toFixed(1), r: 4.5, class: "trend-peak" }));
  const axis = el("div", "trend-axis");
  axis.setAttribute("aria-hidden", "true");
  let lastMonth = "";
  for (const x of weeks) {
    const month = new Date(x.start + "T12:00:00").toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
    axis.append(el("span", undefined, month !== lastMonth ? month : ""));
    lastMonth = month;
  }
  wrap.append(chart, axis);
  return wrap;
}

/** 24 radial bars around a clock face. */
function hourClock(hours: number[]): HTMLElement {
  const wrap = el("div", "clock");
  const max = Math.max(1, ...hours), peak = hours.indexOf(Math.max(...hours));
  const chart = svg("svg", { viewBox: "0 0 200 200", class: "clock-svg", role: "img",
    "aria-label": "Коммиты по часам. Пик: " + peak + ":00" });
  chart.append(svg("circle", { cx: 100, cy: 100, r: 34, class: "clock-face" }));
  chart.append(svg("circle", { cx: 100, cy: 100, r: 92, class: "clock-ring" }));
  hours.forEach((v, h) => {
    const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const inner = 40, outer = 40 + Math.max(3, v / max * 46);
    const line = svg("line", {
      x1: (100 + Math.cos(angle) * inner).toFixed(2), y1: (100 + Math.sin(angle) * inner).toFixed(2),
      x2: (100 + Math.cos(angle) * outer).toFixed(2), y2: (100 + Math.sin(angle) * outer).toFixed(2),
      class: "clock-bar" + (h === peak && v > 0 ? " peak" : ""), pathLength: 100
    });
    line.style.setProperty("--hue", String(Math.round(230 + (h / 23) * 150) % 360));
    line.style.setProperty("--i", String(h));
    const tip = svg("title");
    tip.textContent = h + ":00 — " + num(v);
    line.append(tip);
    chart.append(line);
  });
  for (const [h, x, y] of [[0, 100, 12], [6, 192, 104], [12, 100, 196], [18, 8, 104]] as const) {
    const label = svg("text", { x, y, class: "clock-label", "text-anchor": "middle" });
    label.textContent = String(h);
    chart.append(label);
  }
  const centre = el("div", "clock-centre");
  centre.append(el("strong", undefined, String(peak).padStart(2, "0") + ":00"), el("span", undefined, "пик"));
  wrap.append(chart, centre);
  return wrap;
}

function columns(values: number[], labels: string[], label: string, hueFrom: number, hueTo: number): HTMLElement {
  const chart = el("div", "columns");
  chart.setAttribute("role", "img");
  const max = Math.max(1, ...values), peak = values.indexOf(Math.max(...values));
  chart.setAttribute("aria-label", label + ". Пик: " + (labels[peak] ?? "") + " — " + num(values[peak]));
  values.forEach((value, i) => {
    const col = el("div", "column" + (i === peak && value > 0 ? " peak" : ""));
    col.style.setProperty("--h", (value / max * 100).toFixed(1) + "%");
    col.style.setProperty("--hue", String(Math.round(hueFrom + (hueTo - hueFrom) * i / Math.max(1, values.length - 1))));
    col.style.setProperty("--i", String(i));
    col.title = labels[i] + ": " + num(value);
    const fill = el("span", "column-fill");
    fill.append(el("span", "column-value", value ? compact.format(value) : ""));
    col.append(fill, el("span", "column-label", labels[i]));
    chart.append(col);
  });
  return chart;
}

/** Horizontal histogram: label, proportional bar, value and share. */
function hbars(rows: { label: string; value: number; hue: number; icon?: IconName; mono?: boolean }[], caption: string): HTMLElement {
  const list = el("div", "hbars");
  list.setAttribute("role", "img");
  list.setAttribute("aria-label", caption + ": " + rows.map(r => r.label + " " + num(r.value)).join(", "));
  const max = Math.max(1, ...rows.map(r => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  rows.forEach((row, i) => {
    const line = el("div", "hbar");
    line.style.setProperty("--hue", String(row.hue));
    line.style.setProperty("--w", Math.max(1.5, row.value / max * 100).toFixed(1) + "%");
    line.style.setProperty("--i", String(i));
    const name = el("span", "hbar-name" + (row.mono ? " mono" : ""));
    if (row.icon) name.append(createIcon(row.icon));
    name.append(el("span", undefined, row.label));
    const track = el("span", "hbar-track");
    track.append(el("span", "hbar-fill"));
    const value = el("span", "hbar-value");
    countUp(value, num(row.value), i * 70);
    line.append(name, track, value, el("span", "hbar-share", (row.value / total * 100).toFixed(1) + "%"));
    list.append(line);
  });
  return list;
}

function heatmap(days: { date: string; commits: number }[]): HTMLElement {
  const wrap = el("div", "heatmap");
  const max = Math.max(1, ...days.map(d => d.commits));
  const cells = el("div", "heatmap-grid");
  cells.setAttribute("role", "img");
  cells.setAttribute("aria-label", "Карта активности за 26 недель: " + num(days.reduce((s, d) => s + d.commits, 0)) + " коммитов");
  days.forEach((day, i) => {
    const cell = el("span", "heatmap-cell");
    cell.dataset.level = String(day.commits === 0 ? 0 : Math.min(4, Math.ceil(day.commits / max * 4)));
    cell.style.setProperty("--i", String(i));
    cell.title = new Date(day.date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }) +
      " · " + num(day.commits);
    cells.append(cell);
  });
  const legend = el("div", "heatmap-legend");
  legend.append(el("span", undefined, "меньше"));
  for (let level = 0; level <= 4; level++) {
    const swatch = el("span", "heatmap-cell");
    swatch.dataset.level = String(level);
    legend.append(swatch);
  }
  legend.append(el("span", undefined, "больше"));
  wrap.append(cells, legend);
  return wrap;
}

function donut(parts: { label: string; value: number; hue: number }[], centre: string, caption: string): HTMLElement {
  const wrap = el("div", "donut");
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  const chart = svg("svg", { viewBox: "0 0 120 120", role: "img",
    "aria-label": parts.map(p => p.label + " " + Math.round(p.value / total * 100) + "%").join(", ") });
  chart.append(svg("circle", { cx: 60, cy: 60, r: 48, class: "donut-track", pathLength: 100 }));
  let offset = 0;
  parts.forEach((part, i) => {
    const length = part.value / total * 100;
    const arc = svg("circle", { cx: 60, cy: 60, r: 48, class: "donut-arc", pathLength: 100, "stroke-dashoffset": (-offset).toFixed(2) });
    arc.style.setProperty("--hue", String(part.hue));
    arc.style.setProperty("--len", Math.max(0, length - .6).toFixed(2));
    arc.style.setProperty("--i", String(i));
    offset += length;
    chart.append(arc);
  });
  const middle = el("div", "donut-centre");
  middle.append(el("strong", undefined, centre), el("span", undefined, caption));
  const figure = el("div", "donut-figure");
  figure.append(chart, middle);
  const legend = el("ul", "donut-legend");
  for (const part of parts) {
    const item = el("li");
    item.style.setProperty("--hue", String(part.hue));
    item.append(el("span", "dot"), el("span", undefined, part.label),
      el("strong", undefined, num(part.value)), el("span", "share", (part.value / total * 100).toFixed(1) + "%"));
    legend.append(item);
  }
  wrap.append(figure, legend);
  return wrap;
}

function gauge(percent: number | null, label: string, hint: string): HTMLElement {
  const wrap = el("div", "gauge" + (percent === null ? " is-empty" : ""));
  const chart = svg("svg", { viewBox: "0 0 120 70", role: "img", "aria-label": label + ": " + (percent === null ? "нет данных" : percent + "%") });
  const arc = "M12 62a48 48 0 0 1 96 0";
  chart.append(svg("path", { d: arc, class: "gauge-track", pathLength: 100 }));
  const fill = svg("path", { d: arc, class: "gauge-fill", pathLength: 100 });
  fill.style.setProperty("--p", String(Math.max(0, Math.min(100, percent ?? 0))));
  chart.append(fill);
  const value = el("strong", "gauge-value");
  countUp(value, percent === null ? "—" : String(percent).replace(".", ",") + "%", 120);
  const dial = el("div", "gauge-dial");
  dial.append(chart, value);
  const text = el("div", "gauge-text");
  text.append(el("span", "gauge-label", label), el("small", undefined, hint));
  wrap.append(dial, text);
  return wrap;
}

/* ---------- Page ---------- */

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
function projectAge(first: string | null | undefined): string | null {
  if (!first) return null;
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(first)) / 86_400_000));
  if (!Number.isFinite(days)) return null;
  return days === 0 ? "Сегодня" : days + " " + plural(days, "день", "дня", "дней");
}
function chapter(icon: IconName, title: string, hue: number): HTMLElement {
  const head = el("h4", "insight-chapter span-xl");
  head.style.setProperty("--hue", String(hue));
  head.append(iconChip(icon, "insight-chapter-icon"), el("span", undefined, title));
  return head;
}
function spanned(node: HTMLElement, span: "s" | "m" | "l" | "xl"): HTMLElement {
  node.classList.add("span-" + span);
  return node;
}

export function mountProjectInsights(parent: HTMLElement): void {
  const root = el("section", "insights");
  root.setAttribute("aria-label", "Аналитика проекта");

  const hero = el("header", "insights-hero");
  const heroText = el("div", "insights-hero-text");
  const status = el("p", "insights-status", "Собираю историю Git и измерения…");
  status.setAttribute("role", "status");
  heroText.append(el("span", "insights-kicker", "Akariya Insights"), el("h3", "insights-title", "Аналитика проекта"), status);
  const refresh = el("button", "insights-refresh");
  refresh.type = "button";
  refresh.append(createIcon("refresh"), el("span", undefined, "Пересчитать"));
  hero.append(iconChip("microscope", "insights-hero-icon"), heroText, refresh);

  const kpis = el("div", "insights-kpis");
  const board = el("div", "insights-board");
  const notes = el("details", "insights-notes");
  const notesSummary = el("summary");
  notesSummary.append(createIcon("info"), el("span", undefined, "Как считаются показатели"));
  const notesList = el("ul");
  notes.append(notesSummary, notesList);
  notes.hidden = true;
  root.append(hero, kpis, board, notes);
  parent.append(root);

  let loading = false;
  const load = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    root.classList.add("is-loading");
    status.textContent = "Собираю историю Git и измерения…";
    if (!kpis.childElementCount) for (let i = 0; i < 6; i++) kpis.append(el("div", "insight-skeleton kpi"));
    if (!board.childElementCount) for (let i = 0; i < 4; i++) board.append(el("div", "insight-skeleton span-m"));
    const [historyResult, deepResult] = await Promise.allSettled([
      fetch("/api/updates/statistics", { cache: "no-store", signal: AbortSignal.timeout(60_000) })
        .then(r => { if (!r.ok) throw Error("HTTP " + r.status); return r.json() as Promise<HistoryStats>; }),
      fetch("/api/updates/statistics/deep", { cache: "no-store", signal: AbortSignal.timeout(90_000) })
        .then(r => { if (!r.ok) throw Error("HTTP " + r.status); return r.json() as Promise<DeepStats>; })
    ]);
    const history = historyResult.status === "fulfilled" ? historyResult.value : null;
    const deep = deepResult.status === "fulfilled" ? deepResult.value : null;
    const errorText = (r: PromiseSettledResult<unknown>): string =>
      r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : "";

    renderKpis(history);
    board.replaceChildren(...renderBoard(history, deep, errorText(historyResult), errorText(deepResult)));

    notesList.replaceChildren();
    const caveats = [...(history?.reason ? [history.reason] : []), ...(deep?.caveats ?? [])];
    for (const caveat of caveats) notesList.append(el("li", undefined, caveat));
    notes.hidden = !caveats.length;

    const at = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    status.textContent = history || deep
      ? "Обновлено в " + at + (history?.available === false ? " · история Git неполная" : "")
      : "Не удалось получить статистику: " + (errorText(historyResult) || errorText(deepResult));
    root.classList.remove("is-loading");
    refresh.disabled = false;
    loading = false;
  };
  refresh.addEventListener("click", () => { void load(); });

  function renderKpis(history: HistoryStats | null): void {
    const days = history?.activity ?? null;
    const weeks = days?.length ? weeklyTotals(days) : null;
    const activeWeeks = days?.length ? weeklyTotals(days.map(d => ({ date: d.date, commits: d.commits > 0 ? 1 : 0 }))) : null;
    const recent = days?.length ? days.slice(-14).map(d => d.commits) : null;
    const items: { icon: IconName; label: string; value: string | null; hue: number; visual?: Element }[] = [
      { icon: "commit", label: "Коммиты", value: history?.commits != null ? num(history.commits) : null, hue: 356,
        ...(weeks ? { visual: miniSpark(weeks.map(w => w.commits), 356) } : {}) },
      { icon: "calendar", label: "Возраст", value: projectAge(history?.firstCommitAt), hue: 28 },
      { icon: "flame", label: "Активные дни", value: history?.activeDays != null ? num(history.activeDays) : null, hue: 45,
        ...(activeWeeks ? { visual: miniSpark(activeWeeks.map(w => w.commits), 45) } : {}) },
      { icon: "trending-up", label: "Лучшая серия", value: history?.longestStreak != null ? history.longestStreak + " " + plural(history.longestStreak, "день", "дня", "дней") : null, hue: 150,
        ...(recent ? { visual: miniSpark(recent, 150) } : {}) },
      { icon: "code", label: "Строки кода", value: history ? num(history.languages.reduce((s, l) => s + l.lines, 0)) : null, hue: 214,
        ...(history?.languages.length ? { visual: miniStack(history.languages.slice(0, 6).map((l, i) => ({ value: l.lines, hue: LANGUAGE_HUES[l.extension] ?? HUES[i]! }))) } : {}) },
      { icon: "users", label: "Авторы", value: history?.authors != null ? num(history.authors) : null, hue: 262 }
    ];
    kpis.replaceChildren(...items.map((item, i) => {
      const box = el("div", "insight-kpi" + (item.value === null ? " is-empty" : ""));
      box.style.setProperty("--hue", String(item.hue));
      const head = el("div", "insight-kpi-head");
      head.append(iconChip(item.icon, "insight-kpi-icon"), el("span", "insight-kpi-label", item.label));
      const body = el("div", "insight-kpi-body");
      const value = el("strong", "insight-kpi-value");
      countUp(value, item.value ?? "—", i * 60);
      body.append(value);
      if (item.visual) body.append(item.visual);
      box.append(head, body);
      trackGlow(box);
      reveal(box, i);
      return box;
    }));
  }

  function renderBoard(history: HistoryStats | null, deep: DeepStats | null, historyError: string, deepError: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    const failure = (message: string): HTMLElement => {
      const box = el("div", "insight-error span-xl");
      box.append(iconChip("alert", "insight-error-icon"), el("p", undefined, "Не удалось загрузить данные: " + (message || "нет ответа")));
      return box;
    };
    const section = (id: string, index: number) => deep?.sections?.find(s => s.id === id) ?? deep?.sections?.[index];
    const fromDeep = (m: DeepMetric): TileSpec => ({ icon: isIconName(m.icon) ? m.icon : "sparkles", label: m.label, value: m.value, detail: m.detail });

    /* History */
    out.push(chapter("history", "История проекта", 356));
    if (!history) out.push(failure(historyError));
    else {
      if (history.activity?.length) {
        const total = history.activity.reduce((s, d) => s + d.commits, 0);
        out.push(card("chart", "Динамика коммитов", num(total) + " за 26 недель · по неделям", "l", weeklyChart(history.activity)));
      }
      if (history.hours?.length === 24) {
        const peak = history.hours.indexOf(Math.max(...history.hours));
        out.push(card(peak >= 6 && peak < 20 ? "sun" : "moon", "Часы активности", "Когда пишется код", "s", hourClock(history.hours)));
      }
      if (history.activity?.length) out.push(card("calendar", "Пульс разработки", "Каждая клетка — один день", "l", heatmap(history.activity)));
      if (history.weekdays?.length === 7) {
        const full = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
        const peak = history.weekdays.indexOf(Math.max(...history.weekdays));
        out.push(card("target", "Ритм недели", "Чаще всего — " + full[peak], "s",
          columns(history.weekdays, ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], "Коммиты по дням недели", 356, 262)));
      }
      if (history.wordsAdded !== null && history.wordsDeleted !== null && history.wordsRewritten !== null)
        out.push(card("pen", "Слова в истории", "Git word-diff по всем коммитам", "m", hbars([
          { label: "Родилось", value: history.wordsAdded, hue: 150, icon: "sprout" },
          { label: "Исчезло", value: history.wordsDeleted, hue: 356, icon: "scissors" },
          { label: "Переписано", value: history.wordsRewritten, hue: 45, icon: "pen" }
        ], "Слова в истории")));
      const shortDay = (iso: string | null | undefined): string | null => iso
        ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }).replace(/\s?г\.$/u, "")
        : null;
      out.push(spanned(tileGrid([
        { icon: "rocket", label: "Первый коммит", value: shortDay(history.firstCommitAt), detail: "Начало истории" },
        { icon: "clock", label: "Последний коммит", value: shortDay(history.lastCommitAt), detail: "Свежее изменение" },
        ...withShares([
          { icon: "file-plus", label: "Новые файлы", value: history.newFiles === null ? null : num(history.newFiles), detail: "Добавления в Git" },
          { icon: "file-x", label: "Удалённые файлы", value: history.deletedFiles === null ? null : num(history.deletedFiles), detail: "Удаления в Git" }
        ]),
        { icon: "flame", label: "Горячий файл", value: history.hottestFile ? num(history.hottestFile.commits) + " правок" : null, path: history.hottestFile?.path },
        { icon: "trending-up", label: "Самый выросший", value: history.biggestGrowth ? num(history.biggestGrowth.netLines) + " строк" : null, path: history.biggestGrowth?.path },
        { icon: "fossil", label: "Старожил", value: history.oldestUntouchedFile ? new Date(history.oldestUntouchedFile.lastChanged).toLocaleDateString("ru-RU") : null, path: history.oldestUntouchedFile?.path }
      ]), "xl"));
    }

    /* Code */
    out.push(chapter("microscope", "Код под микроскопом", 214));
    if (!history && !deep) out.push(failure(historyError || deepError));
    if (history?.languages.length) {
      const top = history.languages.filter(l => l.lines > 0).slice(0, 7);
      const rest = history.languages.slice(7).reduce((s, l) => s + l.lines, 0);
      const rows = [...top, ...(rest ? [{ extension: "прочее", lines: rest }] : [])]
        .map((l, i) => ({ label: l.extension, value: l.lines, hue: LANGUAGE_HUES[l.extension] ?? HUES[(i + 3) % HUES.length]!, mono: true }));
      out.push(card("palette", "Языки", "Строки по расширениям", "m",
        miniStack(rows.map(r => ({ value: r.value, hue: r.hue }))), hbars(rows, "Языки проекта")));
    }
    const mix = deep?.composition;
    if (mix && mix.lines > 0)
      out.push(card("layers", "Состав строк", num(mix.files) + " исходных файлов", "m", donut([
        { label: "Код", value: mix.code, hue: 214 },
        { label: "Комментарии", value: mix.comments, hue: 45 },
        { label: "Пустые", value: mix.blank, hue: 262 }
      ], compact.format(mix.lines), "строк")));
    const codeMetrics = section("code", 1)?.metrics ?? [];
    const constructs = codeMetrics
      .map(m => ({ m, n: m.value && percentIn(m.value) === null ? animatableNumber(m.value)?.target ?? null : null }))
      .filter((x): x is { m: DeepMetric; n: number } => x.n !== null)
      .sort((a, b) => b.n - a.n);
    if (constructs.length)
      out.push(card("function", "Конструкции кода", "Эвристика по исходникам, без AST", "m", hbars(constructs.map((x, i) => ({
        label: x.m.label, value: x.n, hue: HUES[(i + 5) % HUES.length]!, ...(isIconName(x.m.icon) ? { icon: x.m.icon } : {})
      })), "Конструкции кода")));
    if (history?.largestFile)
      out.push(card("ruler", "Размеры файлов", "Строк в файле", "m", hbars([
        { label: "Максимум", value: history.largestFile.lines, hue: 356, icon: "dumbbell" },
        { label: "Среднее", value: Math.round(history.averageCodeLines ?? 0), hue: 45, icon: "chart" },
        { label: "Медиана", value: Math.round(history.medianCodeLines ?? 0), hue: 150, icon: "ruler" },
        { label: "Минимум", value: history.smallestCodeFile?.lines ?? 0, hue: 214, icon: "minimize" }
      ], "Размеры файлов")));
    const codeTiles: TileSpec[] = codeMetrics.filter(m => m.value !== null && percentIn(m.value) !== null).map(fromDeep);
    if (history) codeTiles.push(
      { icon: "folder", label: "Папки", value: num(history.directories), detail: num(history.averageFilesPerDirectory) + " файлов на папку" },
      { icon: "book", label: "Документация", value: num(history.markdownLines) + " строк", detail: "Файлы .md" },
      { icon: "database", label: "JSON", value: num(history.jsonFiles) + " файлов", detail: compact.format(history.jsonBytes) + " байт" }
    );
    if (codeTiles.length) out.push(spanned(tileGrid(codeTiles), "xl"));

    /* Records */
    out.push(chapter("crown", "Рекорды и редкости", 45));
    if (!deep) out.push(failure(deepError));
    else {
      const metrics = section("history", 0)?.metrics ?? [];
      out.push(spanned(tileGrid(withShares(metrics.filter(m => m.value !== null).map(fromDeep))), "xl"));
      const rest = pending(metrics.filter(m => m.value === null));
      if (rest) out.push(spanned(rest, "xl"));
    }

    /* Measurements */
    out.push(chapter("gauge", "Измерения обновлений", 150));
    if (deep) {
      const metrics = section("updater", 2)?.metrics ?? [];
      const measured = metrics.filter(m => m.value !== null);
      const gauges = el("div", "gauge-row");
      gauges.append(
        gauge(typeof deep.successRate === "number" ? deep.successRate : null, "Успешность", "confirmed / prepared"),
        gauge(metrics.length ? Math.round(measured.length / metrics.length * 100) : null, "Покрытие", measured.length + " из " + metrics.length + " измерено")
      );
      out.push(card("lifebuoy", "Здоровье обновлений", "По локальному журналу updater", "m", gauges));
      if (measured.length) out.push(spanned(tileGrid(measured.map(fromDeep)), "m"));
      const rest = pending(metrics.filter(m => m.value === null));
      if (rest) out.push(spanned(rest, "xl"));
    }
    return out;
  }

  void load();
}
