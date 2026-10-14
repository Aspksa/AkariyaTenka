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
type TabId = "history" | "records" | "code" | "measure";

const SVG = "http://www.w3.org/2000/svg";
const format = new Intl.NumberFormat("ru-RU");
const num = (v: number | null | undefined): string => typeof v === "number" && Number.isFinite(v) ? format.format(v) : "—";
const motion = (): boolean => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Distinct hues cycled across tiles so neighbours never share a colour. */
const HUES = [356, 28, 45, 150, 188, 214, 262, 318, 8, 172, 232, 290];
const LANGUAGE_HUES: Record<string, number> = {
  ".ts": 214, ".tsx": 200, ".js": 50, ".mjs": 42, ".cjs": 36, ".css": 280, ".html": 14,
  ".json": 150, ".md": 190, ".ps1": 230, ".bat": 120, ".yml": 340, ".yaml": 340, ".py": 205, ".sh": 100, ".sql": 30
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
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
function countUp(node: HTMLElement, value: string, delay: number): void {
  node.textContent = value;
  const parsed = animatableNumber(value);
  if (!parsed || !motion()) return;
  const { target, decimals, separator, suffix } = parsed;
  const render = (v: number): string => decimals
    ? v.toFixed(decimals).replace(".", separator) + suffix
    : format.format(Math.round(v)) + suffix;
  node.textContent = render(0);
  const duration = 1200, startedAt = performance.now() + delay;
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
function reveal(node: HTMLElement, index: number): void {
  node.classList.add("reveal");
  node.style.setProperty("--delay", Math.min(index, 16) * 45 + "ms");
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

interface TileSpec { icon: IconName; label: string; value: string | null; detail?: string | undefined; path?: string | undefined; hue?: number; wide?: boolean }
function tile(spec: TileSpec, index: number): HTMLElement {
  const card = el("article", "insight-tile" + (spec.wide ? " wide" : ""));
  card.style.setProperty("--hue", String(spec.hue ?? HUES[index % HUES.length]));
  const head = el("div", "insight-tile-head");
  head.append(iconChip(spec.icon), el("span", "insight-tile-label", spec.label));
  const value = el("p", "insight-tile-value");
  if (spec.value === null || spec.value === "") {
    card.classList.add("is-empty");
    value.textContent = "Не измеряется";
  } else {
    // Long textual facts (paths, commit subjects, identifiers) use a calmer type size than headline numbers.
    if (spec.value.length > 18 && !animatableNumber(spec.value)) value.classList.add("is-long");
    countUp(value, spec.value, Math.min(index, 16) * 45);
  }
  card.append(head, value);
  if (spec.path) {
    const code = el("code", "insight-path", spec.path);
    code.title = spec.path;
    card.append(code);
  }
  if (spec.detail) card.append(el("small", "insight-tile-detail", spec.detail));
  trackGlow(card);
  reveal(card, index);
  return card;
}
function grid(cards: HTMLElement[]): HTMLElement {
  const wrap = el("div", "insight-grid");
  wrap.append(...cards);
  return wrap;
}
function block(icon: IconName, title: string, subtitle: string, ...body: HTMLElement[]): HTMLElement {
  const box = el("section", "insight-block");
  const head = el("header", "insight-block-head");
  const text = el("div");
  text.append(el("h4", undefined, title), el("p", undefined, subtitle));
  head.append(iconChip(icon, "insight-block-icon"), text);
  box.append(head, ...body);
  reveal(box, 0);
  return box;
}

/* ---------- Charts (plain DOM/SVG, no dependencies) ---------- */

function heatmap(days: { date: string; commits: number }[]): HTMLElement {
  const wrap = el("div", "heatmap");
  const max = Math.max(1, ...days.map(d => d.commits));
  const cells = el("div", "heatmap-grid");
  cells.setAttribute("role", "img");
  const total = days.reduce((sum, d) => sum + d.commits, 0);
  cells.setAttribute("aria-label", "Карта активности за 26 недель: " + num(total) + " коммитов");
  days.forEach((day, i) => {
    const cell = el("span", "heatmap-cell");
    const level = day.commits === 0 ? 0 : Math.min(4, Math.ceil(day.commits / max * 4));
    cell.dataset.level = String(level);
    cell.style.setProperty("--i", String(i));
    cell.title = new Date(day.date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }) +
      " · " + num(day.commits) + " коммит(ов)";
    cells.append(cell);
  });
  const labels = el("div", "heatmap-days");
  labels.setAttribute("aria-hidden", "true");
  for (const name of ["Пн", "", "Ср", "", "Пт", "", "Вс"]) labels.append(el("span", undefined, name));
  const legend = el("div", "heatmap-legend");
  legend.append(el("span", undefined, "Меньше"));
  for (let level = 0; level <= 4; level++) {
    const swatch = el("span", "heatmap-cell");
    swatch.dataset.level = String(level);
    legend.append(swatch);
  }
  legend.append(el("span", undefined, "Больше"));
  const body = el("div", "heatmap-body");
  body.append(labels, cells);
  wrap.append(body, legend);
  return wrap;
}

function bars(values: number[], labels: string[], label: string, hueFrom: number, hueTo: number): HTMLElement {
  const chart = el("div", "bar-chart");
  chart.setAttribute("role", "img");
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  chart.setAttribute("aria-label", label + ". Пик: " + (labels[peak] ?? "") + " — " + num(values[peak]));
  values.forEach((value, i) => {
    const column = el("div", "bar" + (i === peak && value > 0 ? " peak" : ""));
    column.style.setProperty("--h", (value / max * 100).toFixed(1) + "%");
    column.style.setProperty("--hue", String(Math.round(hueFrom + (hueTo - hueFrom) * i / Math.max(1, values.length - 1))));
    column.style.setProperty("--i", String(i));
    column.title = labels[i] + ": " + num(value);
    const fill = el("span", "bar-fill");
    const caption = el("span", "bar-label", labels[i]);
    column.append(fill, caption);
    chart.append(column);
  });
  return chart;
}

function languageBar(languages: { extension: string; lines: number }[]): HTMLElement {
  const wrap = el("div", "language-chart");
  const top = languages.filter(l => l.lines > 0).slice(0, 8);
  const rest = languages.slice(8).reduce((sum, l) => sum + l.lines, 0);
  const items = rest > 0 ? [...top, { extension: "прочее", lines: rest }] : top;
  const total = items.reduce((sum, l) => sum + l.lines, 0) || 1;
  const bar = el("div", "language-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "Доли языков: " + items.map(l => l.extension + " " + Math.round(l.lines / total * 100) + "%").join(", "));
  const legend = el("ul", "language-legend");
  items.forEach((item, i) => {
    const hue = LANGUAGE_HUES[item.extension] ?? HUES[(i + 3) % HUES.length]!;
    const share = item.lines / total * 100;
    const segment = el("span", "language-segment");
    segment.style.setProperty("--w", share.toFixed(2) + "%");
    segment.style.setProperty("--hue", String(hue));
    segment.style.setProperty("--i", String(i));
    segment.title = item.extension + " · " + num(item.lines) + " строк";
    bar.append(segment);
    const entry = el("li");
    entry.style.setProperty("--hue", String(hue));
    entry.append(el("span", "language-dot"), el("strong", undefined, item.extension),
      el("span", "language-lines", num(item.lines)), el("span", "language-share", share.toFixed(1) + "%"));
    legend.append(entry);
  });
  wrap.append(bar, legend);
  return wrap;
}

function donut(parts: { label: string; value: number; hue: number }[], centre: string, caption: string): HTMLElement {
  const wrap = el("div", "donut");
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", parts.map(p => p.label + " " + Math.round(p.value / total * 100) + "%").join(", "));
  const r = 48, c = 2 * Math.PI * r;
  const track = document.createElementNS(SVG, "circle");
  track.setAttribute("class", "donut-track");
  for (const [k, v] of [["cx", "60"], ["cy", "60"], ["r", String(r)]]) track.setAttribute(k!, v!);
  svg.append(track);
  let offset = 0;
  parts.forEach((part, i) => {
    const length = part.value / total * c;
    const arc = document.createElementNS(SVG, "circle");
    arc.setAttribute("class", "donut-arc");
    for (const [k, v] of [["cx", "60"], ["cy", "60"], ["r", String(r)]]) arc.setAttribute(k!, v!);
    arc.style.setProperty("--hue", String(part.hue));
    arc.style.setProperty("--len", Math.max(0, length - 1.5).toFixed(2));
    arc.style.setProperty("--circ", c.toFixed(2));
    arc.style.setProperty("--i", String(i));
    arc.setAttribute("stroke-dashoffset", (-offset).toFixed(2));
    offset += length;
    svg.append(arc);
  });
  const middle = el("div", "donut-centre");
  middle.append(el("strong", undefined, centre), el("span", undefined, caption));
  const figure = el("div", "donut-figure");
  figure.append(svg, middle);
  const legend = el("ul", "donut-legend");
  for (const part of parts) {
    const item = el("li");
    item.style.setProperty("--hue", String(part.hue));
    item.append(el("span", "language-dot"), el("span", undefined, part.label),
      el("strong", undefined, num(part.value)), el("span", "language-share", (part.value / total * 100).toFixed(1) + "%"));
    legend.append(item);
  }
  wrap.append(figure, legend);
  return wrap;
}

function gauge(percent: number | null, label: string): HTMLElement {
  const wrap = el("div", "gauge" + (percent === null ? " is-empty" : ""));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 120 72");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label + ": " + (percent === null ? "нет данных" : percent + "%"));
  const arcPath = "M10 64a50 50 0 0 1 100 0";
  const track = document.createElementNS(SVG, "path");
  track.setAttribute("d", arcPath); track.setAttribute("class", "gauge-track");
  const fill = document.createElementNS(SVG, "path");
  fill.setAttribute("d", arcPath); fill.setAttribute("class", "gauge-fill");
  fill.setAttribute("pathLength", "100");
  fill.style.setProperty("--p", String(Math.max(0, Math.min(100, percent ?? 0))));
  svg.append(track, fill);
  const value = el("strong", "gauge-value");
  countUp(value, percent === null ? "—" : String(percent).replace(".", ",") + "%", 120);
  wrap.append(svg, value, el("span", "gauge-label", label));
  return wrap;
}

function wordsBalance(added: number, deleted: number, rewritten: number): HTMLElement {
  const wrap = el("div", "balance");
  const max = Math.max(1, added, deleted, rewritten);
  const rows: [string, number, number, IconName][] = [
    ["Родилось", added, 150, "sprout"], ["Исчезло", deleted, 356, "scissors"], ["Переписано", rewritten, 45, "pen"]
  ];
  rows.forEach(([name, value, hue, icon], i) => {
    const row = el("div", "balance-row");
    row.style.setProperty("--hue", String(hue));
    row.style.setProperty("--w", (value / max * 100).toFixed(1) + "%");
    row.style.setProperty("--i", String(i));
    const track = el("span", "balance-track");
    track.append(el("span", "balance-fill"));
    const amount = el("strong");
    countUp(amount, num(value), i * 90);
    row.append(iconChip(icon, "balance-icon"), el("span", "balance-name", name), track, amount);
    wrap.append(row);
  });
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

export function mountProjectInsights(parent: HTMLElement): void {
  const root = el("section", "insights");
  root.setAttribute("aria-label", "Аналитика проекта");

  const hero = el("header", "insights-hero");
  const heroIcon = iconChip("microscope", "insights-hero-icon");
  const heroText = el("div", "insights-hero-text");
  const kicker = el("span", "insights-kicker", "Akariya Insights");
  const title = el("h3", "insights-title", "Аналитика проекта");
  const status = el("p", "insights-status", "Собираю историю Git и измерения…");
  status.setAttribute("role", "status");
  heroText.append(kicker, title, status);
  const refresh = el("button", "insights-refresh");
  refresh.type = "button";
  refresh.append(createIcon("refresh"), el("span", undefined, "Пересчитать"));
  hero.append(heroIcon, heroText, refresh);

  const kpis = el("div", "insights-kpis");
  const tabs = el("div", "insights-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Разделы аналитики");
  const indicator = el("span", "insights-tab-indicator");
  indicator.setAttribute("aria-hidden", "true");
  tabs.append(indicator);

  const tabSpecs: { id: TabId; label: string; icon: IconName }[] = [
    { id: "history", label: "История проекта", icon: "history" },
    { id: "records", label: "Углублённая аналитика", icon: "sparkles" },
    { id: "code", label: "Код под микроскопом", icon: "microscope" },
    { id: "measure", label: "Измерения", icon: "gauge" }
  ];
  const panels = new Map<TabId, HTMLElement>();
  const buttons = new Map<TabId, HTMLButtonElement>();
  const tabKey = "akariya-insights-tab";
  let active: TabId = "history";
  try {
    const saved = localStorage.getItem(tabKey);
    if (tabSpecs.some(t => t.id === saved)) active = saved as TabId;
  } catch { /* Storage unavailable */ }

  const placeIndicator = (): void => {
    const button = buttons.get(active);
    if (!button || !button.offsetWidth) return;
    indicator.style.setProperty("--x", button.offsetLeft + "px");
    indicator.style.setProperty("--w", button.offsetWidth + "px");
  };
  const select = (id: TabId, focus = false): void => {
    active = id;
    for (const [key, button] of buttons) {
      const on = key === id;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
      panels.get(key)!.hidden = !on;
    }
    if (focus) buttons.get(id)?.focus();
    buttons.get(id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: motion() ? "smooth" : "auto" });
    placeIndicator();
    try { localStorage.setItem(tabKey, id); } catch { /* Storage unavailable */ }
  };
  for (const spec of tabSpecs) {
    const button = el("button", "insights-tab");
    button.type = "button";
    button.id = "insights-tab-" + spec.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "insights-panel-" + spec.id);
    button.append(createIcon(spec.icon), el("span", undefined, spec.label));
    button.addEventListener("click", () => select(spec.id));
    buttons.set(spec.id, button);
    tabs.append(button);
    const panel = el("div", "insights-panel");
    panel.id = "insights-panel-" + spec.id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panels.set(spec.id, panel);
  }
  tabs.addEventListener("keydown", (event) => {
    const order = tabSpecs.map(t => t.id);
    const at = order.indexOf(active);
    const next = event.key === "ArrowRight" ? order[(at + 1) % order.length]
      : event.key === "ArrowLeft" ? order[(at - 1 + order.length) % order.length]
      : event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1] : undefined;
    if (next) { event.preventDefault(); select(next, true); }
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(placeIndicator).observe(tabs);

  const notes = el("details", "insights-notes");
  const notesSummary = el("summary");
  notesSummary.append(createIcon("info"), el("span", undefined, "Как считаются показатели"));
  const notesList = el("ul");
  notes.append(notesSummary, notesList);

  root.append(hero, kpis, tabs, ...panels.values(), notes);
  parent.append(root);
  select(active);

  const skeleton = (target: HTMLElement, count: number): void => {
    const wrap = el("div", "insight-grid");
    for (let i = 0; i < count; i++) wrap.append(el("div", "insight-skeleton"));
    target.replaceChildren(wrap);
  };

  let loading = false;
  const load = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    root.classList.add("is-loading");
    status.textContent = "Собираю историю Git и измерения…";
    if (!kpis.childElementCount) for (let i = 0; i < 6; i++) kpis.append(el("div", "insight-skeleton kpi"));
    for (const panel of panels.values()) if (!panel.childElementCount) skeleton(panel, 6);
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
    renderHistory(history, errorText(historyResult));
    renderSection("records", deep, "history", errorText(deepResult));
    renderCode(history, deep, errorText(deepResult));
    renderMeasure(deep, errorText(deepResult));

    notesList.replaceChildren();
    const caveats = [...(history?.reason ? [history.reason] : []), ...(deep?.caveats ?? [])];
    for (const caveat of caveats) notesList.append(el("li", undefined, caveat));
    notes.hidden = !caveats.length;

    const at = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    status.textContent = history || deep
      ? "Обновлено в " + at + (history?.available === false ? " · история Git недоступна" : "")
      : "Не удалось получить статистику: " + (errorText(historyResult) || errorText(deepResult));
    root.classList.remove("is-loading");
    refresh.disabled = false;
    loading = false;
    placeIndicator();
  };
  refresh.addEventListener("click", () => { void load(); });

  function renderKpis(history: HistoryStats | null): void {
    const items: { icon: IconName; label: string; value: string | null; hue: number }[] = [
      { icon: "commit", label: "Коммитов", value: history?.commits != null ? num(history.commits) : null, hue: 356 },
      { icon: "calendar", label: "Возраст проекта", value: projectAge(history?.firstCommitAt), hue: 28 },
      { icon: "flame", label: "Активных дней", value: history?.activeDays != null ? num(history.activeDays) : null, hue: 45 },
      { icon: "trending-up", label: "Лучшая серия", value: history?.longestStreak != null ? history.longestStreak + " " + plural(history.longestStreak, "день", "дня", "дней") : null, hue: 150 },
      { icon: "code", label: "Строк кода", value: history ? num(history.languages.reduce((s, l) => s + l.lines, 0)) : null, hue: 214 },
      { icon: "users", label: "Авторов", value: history?.authors != null ? num(history.authors) : null, hue: 262 }
    ];
    kpis.replaceChildren(...items.map((item, i) => {
      const card = el("div", "insight-kpi" + (item.value === null ? " is-empty" : ""));
      card.style.setProperty("--hue", String(item.hue));
      const value = el("strong", "insight-kpi-value");
      if (item.value === null) value.textContent = "—"; else countUp(value, item.value, i * 70);
      card.append(iconChip(item.icon, "insight-kpi-icon"), value, el("span", "insight-kpi-label", item.label));
      trackGlow(card);
      reveal(card, i);
      return card;
    }));
  }

  function failure(panel: HTMLElement, message: string): void {
    const box = el("div", "insight-error");
    box.append(iconChip("alert", "insight-error-icon"), el("p", undefined, "Не удалось загрузить данные: " + (message || "нет ответа")));
    panel.replaceChildren(box);
  }

  function renderHistory(data: HistoryStats | null, error: string): void {
    const panel = panels.get("history")!;
    if (!data) { failure(panel, error); return; }
    const content: HTMLElement[] = [];
    if (data.activity?.length) {
      const total = data.activity.reduce((s, d) => s + d.commits, 0);
      content.push(block("calendar", "Пульс разработки", num(total) + " коммитов за последние 26 недель", heatmap(data.activity)));
    }
    const rhythm: HTMLElement[] = [];
    if (data.hours?.length === 24) {
      const hourLabels = data.hours.map((_, h) => h % 3 === 0 ? String(h) : "");
      const chart = bars(data.hours, hourLabels, "Коммиты по часам суток", 230, 20);
      chart.querySelectorAll<HTMLElement>(".bar").forEach((b, h) => { b.title = h + ":00 — " + num(data.hours![h]) + " коммитов"; });
      const peak = data.hours.indexOf(Math.max(...data.hours));
      rhythm.push(block(peak >= 6 && peak < 20 ? "sun" : "moon", "Ритм суток", "Пик продуктивности — около " + peak + ":00", chart));
    }
    if (data.weekdays?.length === 7) {
      const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
      const full = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
      const peak = data.weekdays.indexOf(Math.max(...data.weekdays));
      rhythm.push(block("target", "Ритм недели", "Самый активный день — " + full[peak], bars(data.weekdays, names, "Коммиты по дням недели", 356, 290)));
    }
    if (rhythm.length) { const pair = el("div", "insight-pair"); pair.append(...rhythm); content.push(pair); }
    if (data.wordsAdded !== null && data.wordsDeleted !== null && data.wordsRewritten !== null)
      content.push(block("pen", "Слова в истории", "Git word-diff по всем доступным коммитам", wordsBalance(data.wordsAdded, data.wordsDeleted, data.wordsRewritten)));
    const day = (iso: string | null | undefined): string | null => iso
      ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }).replace(/\s?г\.$/u, "")
      : null;
    const first = day(data.firstCommitAt), last = day(data.lastCommitAt);
    content.push(block("history", "Хроника файлов", "Рождения, потери и рекорды", grid([
      tile({ icon: "rocket", label: "Первый коммит", value: first, detail: "Начало истории проекта" }, 0),
      tile({ icon: "clock", label: "Последний коммит", value: last, detail: "Самое свежее изменение" }, 1),
      tile({ icon: "file-plus", label: "Новорождённые файлы", value: data.newFiles === null ? null : num(data.newFiles), detail: "Git-события добавления файлов" }, 2),
      tile({ icon: "file-x", label: "Кладбище файлов", value: data.deletedFiles === null ? null : num(data.deletedFiles), detail: "Git-события удаления файлов" }, 3),
      tile({ icon: "flame", label: "Горячий файл", value: data.hottestFile ? num(data.hottestFile.commits) + " изменений" : null, path: data.hottestFile?.path }, 4),
      tile({ icon: "trending-up", label: "Самый выросший", value: data.biggestGrowth ? num(data.biggestGrowth.netLines) + " строк" : null, path: data.biggestGrowth?.path }, 5),
      tile({ icon: "fossil", label: "Старожил проекта", value: data.oldestUntouchedFile ? new Date(data.oldestUntouchedFile.lastChanged).toLocaleDateString("ru-RU") : null, path: data.oldestUntouchedFile?.path, detail: "Дольше всех без изменений" }, 6)
    ])));
    panel.replaceChildren(...content);
  }

  function deepTiles(section: { metrics: DeepMetric[] } | undefined, offset = 0): HTMLElement[] {
    return (section?.metrics ?? []).map((m, i) => tile({
      icon: isIconName(m.icon) ? m.icon : "sparkles",
      label: m.label.replace(/^\P{L}+/u, ""),
      value: m.value, detail: m.detail
    }, i + offset));
  }
  const findSection = (deep: DeepStats | null, id: string, index: number) =>
    deep?.sections?.find(s => s.id === id) ?? deep?.sections?.[index];

  function renderSection(tab: TabId, deep: DeepStats | null, id: string, error: string): void {
    const panel = panels.get(tab)!;
    if (!deep) { failure(panel, error); return; }
    const section = findSection(deep, id, 0);
    panel.replaceChildren(block("crown", "Рекорды и редкости", "Самые яркие факты из истории и исходников", grid(deepTiles(section))));
  }

  function renderCode(history: HistoryStats | null, deep: DeepStats | null, error: string): void {
    const panel = panels.get("code")!;
    if (!history && !deep) { failure(panel, error); return; }
    const content: HTMLElement[] = [];
    const visuals: HTMLElement[] = [];
    if (history?.languages.length)
      visuals.push(block("palette", "Языки проекта", "Строки по расширениям в текущем коде", languageBar(history.languages)));
    const mix = deep?.composition;
    if (mix && mix.lines > 0)
      visuals.push(block("layers", "Состав строк", num(mix.files) + " исходных файлов", donut([
        { label: "Код", value: mix.code, hue: 214 },
        { label: "Комментарии", value: mix.comments, hue: 45 },
        { label: "Пустые", value: mix.blank, hue: 262 }
      ], num(mix.lines), "строк")));
    if (visuals.length) { const pair = el("div", "insight-pair"); pair.append(...visuals); content.push(pair); }
    if (deep) content.push(block("microscope", "Конструкции кода", "Эвристический подсчёт по исходникам", grid(deepTiles(findSection(deep, "code", 1)))));
    if (history) content.push(block("ruler", "Размеры и структура", "Текущие файлы, отслеживаемые Git", grid([
      tile({ icon: "dumbbell", label: "Файл-гигант", value: history.largestFile ? num(history.largestFile.lines) + " строк" : null, path: history.largestFile?.path }, 0),
      tile({ icon: "minimize", label: "Самый маленький", value: history.smallestCodeFile ? num(history.smallestCodeFile.lines) + " строк" : null, path: history.smallestCodeFile?.path }, 1),
      tile({ icon: "chart", label: "Средний файл", value: history.averageCodeLines === null ? null : num(history.averageCodeLines) + " строк", detail: "Медиана: " + num(history.medianCodeLines) + " строк" }, 2),
      tile({ icon: "folder", label: "Папки", value: num(history.directories), detail: num(history.averageFilesPerDirectory) + " файлов на каталог в среднем" }, 3),
      tile({ icon: "book", label: "Документация", value: num(history.markdownLines) + " строк", detail: "Текущие файлы .md" }, 4),
      tile({ icon: "database", label: "Данные JSON", value: num(history.jsonFiles) + " файлов", detail: num(history.jsonBytes) + " байт" }, 5)
    ])));
    panel.replaceChildren(...content);
  }

  function renderMeasure(deep: DeepStats | null, error: string): void {
    const panel = panels.get("measure")!;
    if (!deep) { failure(panel, error); return; }
    const section = findSection(deep, "updater", 2);
    const measured = (section?.metrics ?? []).filter(m => m.value !== null).length;
    const total = section?.metrics.length ?? 0;
    const gauges = el("div", "gauge-row");
    gauges.append(
      gauge(typeof deep.successRate === "number" ? deep.successRate : null, "Успешность обновлений"),
      gauge(total ? Math.round(measured / total * 100) : null, "Покрытие измерениями")
    );
    panel.replaceChildren(
      block("gauge", "Здоровье обновлений", measured + " из " + total + " показателей измерено на этой машине", gauges),
      block("radar", "Измерения updater", "Телеметрия последних установок и откатов", grid(deepTiles(section)))
    );
  }

  void load();
}
