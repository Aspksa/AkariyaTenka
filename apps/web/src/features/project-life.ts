/**
 * «Жизнь проекта» (ported from JUUNIBI): the panel beside the update centre with figures about Akariya's history,
 * grouped and drawn as tiles, each with a small chart (life-charts.ts).
 */
import { createIcon, type IconName } from "../components/icons.js";
import { barChart, el, miniChart, ringChart } from "./life-charts.js";
import { changeText, changeTone, decorateChange, type MetricChange } from "./life-change.js";

export interface ProjectMetric {
  id: string; group: string; emoji: string; title: string; hint: string; value: string; detail: string;
  kind?: string; series?: number[]; list?: string[]; labels?: string[]; ring?: number;
  /** Set when the figure differs from the version installed before this one. */
  change?: MetricChange;
}
export interface ProjectStatsData {
  version: 1; generatedAt: string; head: string; commits: number;
  groups: { id: string; title: string }[]; metrics: ProjectMetric[];
  source?: "git" | "github" | "saved";
  since?: { head: string; at: string };
}

const OPEN_KEY = "akariya.life.open";
const GROUP_ICON: Record<string, IconName> = { anatomy: "file", mind: "brain", life: "pulse", care: "shield", fun: "puzzle", code: "search" };
const HIGHLIGHTS = ["age", "words_added", "tests", "experiments"];
const HOURS_LABEL = ["0", "6", "12", "18", "23"];

let host: HTMLElement | null = null;
let loadedAt = 0;
let data: ProjectStatsData | null = null;
let error = "";
let loading = false;
let slow = false;

const icon = (name: IconName, size: number): SVGSVGElement => {
  const svg = createIcon(name);
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  return svg;
};
const readOpen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '["anatomy","mind"]') as string[]); } catch { return new Set(["anatomy", "mind"]); } };
const saveOpen = (s: Set<string>): void => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* private mode */ } };

/** «5 минут назад» for the time the figures were counted. */
export function agoText(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Five weeks of commits, oldest top-left, as a heat grid. */
function heat(series: number[]): HTMLElement {
  const max = Math.max(1, ...series);
  return el("div", { cls: "life-heat", attrs: { "aria-hidden": "true" } }, ...series.map((v, i) => {
    const c = el("i", { title: `${v} коммитов` });
    c.style.setProperty("--a", v ? String(0.25 + (0.75 * v) / max) : "0");
    c.style.setProperty("--d", String(i));
    return c;
  }));
}

function tile(m: ProjectMetric, i: number): HTMLElement {
  const empty = m.value === "—";
  const wide = m.kind === "hours" && m.series ? el("div", {}, barChart(m.series, m.series.map((_, h) => `${h}:00`), "hours"), el("div", { cls: "life-axis" }, ...HOURS_LABEL.map((x) => el("span", { textContent: x }))))
    : m.kind === "calendar" && m.series ? heat(m.series)
    : m.kind === "list" && m.list ? el("ul", { cls: "life-list" }, ...m.list.map((x) => el("li", { cls: x.startsWith("✓") ? "on" : x.startsWith("·") ? "off" : "", textContent: x })))
    : null;
  const mini = wide || empty ? null : miniChart(m.kind, m.series, m.labels, m.list);
  const ring = typeof m.ring === "number" && !empty ? ringChart(m.ring) : null;
  const t = el("article", { cls: "life-tile" + (wide ? " wide" : "") + (empty ? " empty" : ""), title: m.hint, attrs: { tabindex: "0" } });
  const changed = m.change && !empty ? decorateChange(t, m.id, m.value, m.change, data?.since?.head.slice(0, 7) ?? null) : null;
  t.append(...[
    el("div", { cls: "life-tile-top" }, el("span", { cls: "life-emoji", attrs: { "aria-hidden": "true" }, textContent: m.emoji }),
      el("div", { cls: "life-tile-name" }, el("strong", { textContent: m.title }), el("small", { textContent: m.hint }))),
    el("div", { cls: "life-value-row" }, changed?.value ?? el("div", { cls: "life-value", textContent: m.value }), changed?.badge, ring),
    changed?.compare,
    m.detail ? el("p", { cls: "life-detail", textContent: m.detail }) : null,
    mini ? el("div", { cls: "life-mini" }, mini) : null,
    wide].filter((x): x is HTMLElement => !!x));
  t.style.setProperty("--i", String(i));
  return t;
}

function render(): void {
  if (!host) return;
  const refresh = el("button", { cls: "icon-btn sm" + (loading ? " spin" : ""), title: "Пересчитать показатели", attrs: { type: "button", "aria-label": "Пересчитать показатели" } }, icon("refresh", 16));
  refresh.disabled = loading;
  refresh.addEventListener("click", () => void load(true));
  const src = data?.source === "git" ? "по истории git" : data?.source === "github" ? "с GitHub" : data?.source === "saved" ? "сохранённая копия" : "";
  const head = el("header", { cls: "life-head" },
    el("div", { cls: "life-head-text" }, el("h2", {}, el("span", { cls: "life-pulse", attrs: { "aria-hidden": "true" } }), "Жизнь проекта"),
      el("p", { textContent: data ? [`${data.commits.toLocaleString("ru-RU")} коммитов`, agoText(data.generatedAt), src].filter(Boolean).join(" · ") : "Необычные показатели Akariya" }),
      data?.since ? el("p", { cls: "life-since" }, el("span", { cls: "life-since-dot", attrs: { "aria-hidden": "true" } }),
        data.metrics.some((m) => m.change) ? `Сравнение с версией ${data.since.head.slice(0, 7)}` : `После версии ${data.since.head.slice(0, 7)} показатели не изменились`) : null),
    refresh);
  if (!data) {
    host.replaceChildren(head, error
      ? el("div", { cls: "life-empty" }, el("span", {}, icon("cloud", 28)), el("p", { textContent: error }))
      : slow ? el("div", { cls: "life-empty" }, el("span", {}, icon("cloud", 28)), el("p", { textContent: "Считаю долго: история большая или нет связи с GitHub. Показатели появятся сами." }))
      : el("div", { cls: "life-skeleton", attrs: { "aria-label": "Загрузка показателей" } }, ...Array.from({ length: 6 }, () => el("i"))));
    return;
  }
  const current = data;
  const by = new Map(current.metrics.map((m) => [m.id, m]));
  const highlights = HIGHLIGHTS.map((id) => by.get(id)).filter((m): m is ProjectMetric => !!m);
  const open = readOpen();
  const tiles = new Map<string, HTMLElement>(), details = new Map<string, HTMLDetailsElement>();
  const changed = current.metrics.filter((m) => m.change && m.value !== "—");
  const groups = current.groups.map((g) => {
    const items = current.metrics.filter((m) => m.group === g.id);
    const moved = items.filter((m) => m.change && m.value !== "—").length;
    const badge = moved ? el("span", { cls: "life-group-changed", title: `Изменилось после обновления: ${moved}` }, el("i", { attrs: { "aria-hidden": "true" } }), "+" + moved) : null;
    const d = el("details", { cls: "life-group g-" + g.id + (moved ? " has-changes" : "") },
      el("summary", {}, el("span", { cls: "life-group-ic", attrs: { "aria-hidden": "true" } }, icon(GROUP_ICON[g.id] ?? "sparkles", 16)),
        el("span", { cls: "grow", textContent: g.title }), badge, el("span", { cls: "life-count", textContent: String(items.length) }), icon("chevron-down", 16)),
      el("div", { cls: "life-grid" }, ...items.map((m, i) => { const t = tile(m, i); tiles.set(m.id, t); return t; })));
    d.open = open.has(g.id);
    d.addEventListener("toggle", () => { const s = readOpen(); if (d.open) s.add(g.id); else s.delete(g.id); saveOpen(s); });
    details.set(g.id, d);
    return d;
  });
  const jump = (m: ProjectMetric): void => {
    const d = details.get(m.group), t = tiles.get(m.id);
    if (!d || !t) return;
    d.open = true;
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
    t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    t.focus({ preventScroll: true });
  };
  host.replaceChildren(head,
    el("div", { cls: "life-highlights" }, ...highlights.map((m) => el("div", { cls: "life-hl", title: m.hint }, el("span", { textContent: m.emoji }), el("b", { textContent: m.value }), el("small", { textContent: m.title })))),
    ...(current.since && changed.length ? [changesBlock(current, changed, jump)] : []),
    ...groups,
    ...(error ? [el("p", { cls: "life-note", textContent: error })] : []));
}

const SHOWN_CHANGES = 6;
/** «После обновления»: every figure that moved, the biggest steps first; a click opens its group and lights the tile. */
function changesBlock(current: ProjectStatsData, changed: ProjectMetric[], jump: (m: ProjectMetric) => void): HTMLElement {
  const groupTitle = new Map(current.groups.map((g) => [g.id, g.title]));
  const weight = (m: ProjectMetric): number => { const c = m.change!; return c.from === 0 ? Infinity : Math.abs((c.to - c.from) / c.from); };
  const sorted = [...changed].sort((a, b) => weight(b) - weight(a));
  const counts = { good: 0, bad: 0, neutral: 0 };
  for (const m of sorted) counts[changeTone(m.id, m.change!)]++;
  const list = el("ol", { cls: "life-changes-list" });
  const fill = (n: number): void => {
    list.replaceChildren(...sorted.slice(0, n).map((m, i) => {
      const c = m.change!, tone = changeTone(m.id, c), { delta, percent } = changeText(c);
      const row = el("button", { cls: "life-change-row tone-" + tone, title: `${m.title}: было ${c.before}, стало ${m.value} (${percent}). Показать плитку`, attrs: { type: "button" } },
        el("span", { cls: "life-change-emoji", textContent: m.emoji, attrs: { "aria-hidden": "true" } }),
        el("span", { cls: "life-change-name" }, el("b", { textContent: m.title }), el("small", { cls: "g-" + m.group, textContent: groupTitle.get(m.group) ?? "" })),
        el("span", { cls: "life-change-values" }, el("s", { textContent: c.before }), el("span", { textContent: "→", attrs: { "aria-hidden": "true" } }), el("b", { textContent: m.value })),
        el("span", { cls: "life-change-delta" + (c.to > c.from ? " up" : " down") }, (c.to > c.from ? "↑ " : "↓ ") + delta));
      row.style.setProperty("--i", String(i));
      row.addEventListener("click", () => jump(m));
      return el("li", {}, row);
    }));
  };
  fill(SHOWN_CHANGES);
  const more = sorted.length > SHOWN_CHANGES ? el("button", { cls: "life-changes-more", textContent: `Показать все ${sorted.length}`, attrs: { type: "button" } }) : null;
  more?.addEventListener("click", () => { fill(sorted.length); more.remove(); });
  const sinceDate = Date.parse(current.since!.at);
  return el("section", { cls: "life-changes", attrs: { "aria-label": "Что изменилось после обновления" } },
    el("header", { cls: "life-changes-head" },
      el("div", {}, el("strong", { textContent: "После обновления" }),
        el("small", { textContent: `${changed.length} ${changed.length % 10 === 1 && changed.length % 100 !== 11 ? "показатель" : changed.length % 10 >= 2 && changed.length % 10 <= 4 && (changed.length % 100 < 12 || changed.length % 100 > 14) ? "показателя" : "показателей"} изменились с версии ${current.since!.head.slice(0, 7)}` + (Number.isFinite(sinceDate) ? ", " + agoText(current.since!.at) : "") })),
      el("div", { cls: "life-changes-tally" },
        counts.good ? el("span", { cls: "tone-good", title: "Стало лучше", textContent: "▲ " + counts.good }) : null,
        counts.bad ? el("span", { cls: "tone-bad", title: "Стало хуже", textContent: "▼ " + counts.bad }) : null,
        counts.neutral ? el("span", { cls: "tone-neutral", title: "Просто изменилось", textContent: "● " + counts.neutral }) : null)),
    list, more);
}

async function fetchStats(force: boolean): Promise<ProjectStatsData> {
  const r = await fetch("/api/updates/project-stats" + (force ? "?force=1" : ""), { cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!r.ok) {
    const body = await r.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Показатели недоступны (HTTP " + r.status + ")");
  }
  const value = await r.json() as ProjectStatsData;
  if (value?.version !== 1 || !Array.isArray(value.metrics) || !Array.isArray(value.groups)) throw new Error("Неожиданный ответ сервера");
  return value;
}

async function load(force = false): Promise<void> {
  if (loading) return;
  loading = true; slow = false; render();
  // a long history or no internet can take a while: say so instead of leaving grey blocks forever
  const timer = setTimeout(() => { if (loading && !data) { slow = true; render(); } }, 8000);
  try {
    data = await fetchStats(force); error = "";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    error = data ? "Не удалось обновить: " + message : message;
  } finally {
    clearTimeout(timer);
    loading = false; slow = false;
    loadedAt = Date.now();
  }
  render();
}

/** The panel; data is (re)loaded when the page is opened and the figures are older than five minutes. */
export function projectLifePanel(): HTMLElement {
  if (!host) host = el("aside", { cls: "life", attrs: { "aria-label": "Жизнь проекта" } });
  if (!loading && Date.now() - loadedAt > 5 * 60_000) void load(); else if (!host.childElementCount) render();
  return host;
}
