/**
 * «История обновлений»: the updater writes one journal line per step (download, check, preparation,
 * confirmation, rollback, failure). Here the steps are joined into attempts, and every attempt becomes
 * one card with its outcome, the versions «было → стало», the stages it went through and how long it took.
 */
import { createIcon, type IconName } from "../components/icons.js";
import { relativeTime } from "../components/notifications.js";

export interface HistoryEvent { at: string; event: string; revision: string | null }
export type AttemptOutcome = "installed" | "restored" | "rolled_back" | "failed" | "running" | "interrupted";
export interface Attempt {
  kind: "install" | "restore";
  revision: string | null;
  /** The version that was running before, when the journal knows it. */
  from: string | null;
  outcome: AttemptOutcome;
  startedAt: number; endedAt: number;
  events: HistoryEvent[];
}

const TERMINAL: Record<string, AttemptOutcome | undefined> = { confirmed: "installed", rolled_back: "rolled_back", failed: "failed" };
const STALE_MS = 15 * 60_000;

/** Joins journal lines (newest first, as the server sends them) into attempts, newest first. */
export function groupAttempts(events: HistoryEvent[], now = Date.now()): Attempt[] {
  const chrono = events.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const attempts: Attempt[] = [];
  for (const e of chrono) {
    const at = Date.parse(e.at);
    let cur = attempts[attempts.length - 1];
    const finished = cur && cur.outcome !== "running";
    // a rollback right after a failed or confirmed attempt of the same version belongs to it
    const lateRollback = cur && e.event === "rolled_back" && (e.revision === null || e.revision === cur.revision);
    if (!cur || e.event === "download_started" || (finished && !lateRollback) ||
        (!lateRollback && e.revision && cur.revision && e.revision !== cur.revision)) {
      cur = { kind: e.event === "download_started" ? "install" : "restore", revision: e.revision, from: null, outcome: "running", startedAt: at, endedAt: at, events: [] };
      attempts.push(cur);
    }
    cur.events.push(e);
    cur.endedAt = at;
    cur.revision ??= e.revision;
    const outcome = TERMINAL[e.event];
    if (outcome) cur.outcome = outcome === "installed" && cur.kind === "restore" ? "restored" : outcome;
  }
  let running: string | null = null;
  for (const a of attempts) {
    a.from = running;
    if (a.outcome === "running" && now - a.endedAt > STALE_MS) a.outcome = "interrupted";
    if (a.outcome === "installed" || a.outcome === "restored") running = a.revision;
  }
  return attempts.reverse();
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + " с";
  const m = Math.floor(s / 60), rest = s % 60;
  if (m < 60) return rest ? `${m} мин ${rest} с` : `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

const OUTCOME: Record<AttemptOutcome, { title: (a: Attempt) => string; badge: string; icon: IconName }> = {
  installed: { title: () => "Обновление установлено", badge: "Готово", icon: "check" },
  restored: { title: () => "Возвращена прежняя версия", badge: "Возврат", icon: "history" },
  rolled_back: { title: () => "Не запустилось — откат", badge: "Откат", icon: "lifebuoy" },
  failed: { title: () => "Обновление не установлено", badge: "Ошибка", icon: "alert" },
  running: { title: (a) => a.kind === "install" ? "Идёт обновление" : "Идёт возврат версии", badge: "Сейчас", icon: "refresh" },
  interrupted: { title: () => "Обновление прервано", badge: "Прервано", icon: "pause" }
};
const STAGES: Record<Attempt["kind"], { event: string; label: string }[]> = {
  install: [{ event: "download_started", label: "Загрузка" }, { event: "validated", label: "Проверка" }, { event: "prepared", label: "Установка" }, { event: "confirmed", label: "Запуск" }],
  restore: [{ event: "prepared", label: "Возврат файлов" }, { event: "confirmed", label: "Запуск" }]
};
const COMMIT_URL = "https://github.com/Aspksa/AkariyaTenka/commit/";

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) if (c) node.append(c);
  return node;
}
function version(sha: string | null, label: string): HTMLElement {
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return el("span", "uh-ver unknown", el("small", undefined, label), el("code", undefined, "неизвестна"));
  const link = el("a", "uh-ver", el("small", undefined, label), el("code", undefined, sha.slice(0, 7)));
  link.href = COMMIT_URL + sha; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.title = "Открыть коммит " + sha.slice(0, 12) + " на GitHub";
  return link;
}

function stages(a: Attempt): HTMLElement {
  const reached = new Map(a.events.map((e) => [e.event, Date.parse(e.at)]));
  const list = el("ol", "uh-steps");
  const plan = STAGES[a.kind];
  let failedMarked = false;
  plan.forEach((stage, i) => {
    const at = reached.get(stage.event);
    let state = at !== undefined ? "done" : "todo";
    if (at === undefined && !failedMarked && ["failed", "rolled_back", "interrupted"].includes(a.outcome)) { state = "fail"; failedMarked = true; }
    if (at === undefined && a.outcome === "running" && !failedMarked) { state = "active"; failedMarked = true; }
    const item = el("li", "uh-step " + state,
      el("span", "uh-step-dot", state === "todo" ? null : createIcon(state === "done" ? "check" : state === "fail" ? "close" : "refresh")),
      el("span", "uh-step-label", stage.label),
      el("small", undefined, at !== undefined ? (i === 0 ? new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "+" + durationText(at - a.startedAt)) : ""));
    item.style.setProperty("--i", String(i));
    list.append(item);
  });
  return list;
}

function card(a: Attempt, index: number): HTMLElement {
  const o = OUTCOME[a.outcome];
  const time = el("time", undefined, relativeTime(a.endedAt));
  time.dateTime = new Date(a.endedAt).toISOString();
  time.title = new Date(a.endedAt).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
  const item = el("li", "uh-item outcome-" + a.outcome,
    el("span", "uh-node", createIcon(o.icon)),
    el("article", "uh-card",
      el("header", "uh-head", el("strong", undefined, o.title(a)), el("span", "uh-badge", o.badge), time),
      el("div", "uh-versions", version(a.from, "было"), el("span", "uh-arrow", createIcon("arrow-right")), version(a.revision, a.kind === "restore" ? "вернули" : "стало")),
      stages(a),
      el("footer", "uh-foot", a.endedAt > a.startedAt ? "Заняло " + durationText(a.endedAt - a.startedAt) : "", a.outcome === "rolled_back" ? " · данные и настройки не тронуты" : "")));
  item.style.setProperty("--i", String(index));
  return item;
}

const SHOWN = 4;
const plural = (n: number, one: string, few: string, many: string): string => {
  const a = n % 100, b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many;
};
/** Fills the history card. Called again whenever the journal changes. */
export function renderUpdateHistory(host: HTMLElement, events: HistoryEvent[]): void {
  const attempts = groupAttempts(events);
  if (!attempts.length) {
    host.replaceChildren(el("div", "uh-empty", el("span", "uh-empty-icon", createIcon("history")),
      el("strong", undefined, "История пока пуста"), el("p", undefined, "Здесь появится каждая установка: что было, что стало, сколько заняло и чем закончилось.")));
    return;
  }
  const count = (o: AttemptOutcome[]): number => attempts.filter((a) => o.includes(a.outcome)).length;
  const ok = count(["installed", "restored"]);
  const finished = attempts.filter((a) => a.outcome !== "running").length;
  const strip = el("div", "uh-strip");
  strip.setAttribute("aria-hidden", "true");
  for (const a of attempts.slice(0, 16).reverse()) {
    const seg = el("i", "outcome-" + a.outcome);
    seg.title = OUTCOME[a.outcome].title(a) + " · " + new Date(a.endedAt).toLocaleDateString("ru-RU");
    strip.append(seg);
  }
  const summary = el("div", "uh-summary",
    el("div", "uh-rate", el("strong", undefined, finished ? Math.round(ok / finished * 100) + "%" : "—"), el("small", undefined, "успешных")),
    el("div", "uh-counts",
      el("span", "uh-count ok", createIcon("check"), String(ok), el("small", undefined, " " + plural(ok, "установка", "установки", "установок"))),
      el("span", "uh-count warn", createIcon("lifebuoy"), String(count(["rolled_back"])), el("small", undefined, " " + plural(count(["rolled_back"]), "откат", "отката", "откатов"))),
      el("span", "uh-count bad", createIcon("alert"), String(count(["failed", "interrupted"])), el("small", undefined, " " + plural(count(["failed", "interrupted"]), "ошибка", "ошибки", "ошибок")))),
    strip);
  const list = el("ol", "uh-list");
  const fill = (n: number): void => { list.replaceChildren(...attempts.slice(0, n).map(card)); };
  fill(SHOWN);
  const nodes: HTMLElement[] = [summary, list];
  if (attempts.length > SHOWN) {
    const more = el("button", "uh-more", "Показать всю историю (" + attempts.length + ")");
    more.type = "button";
    more.addEventListener("click", () => { fill(attempts.length); more.remove(); });
    nodes.push(more);
  }
  host.replaceChildren(...nodes);
}

export function renderUpdateHistoryError(host: HTMLElement): void {
  host.replaceChildren(el("div", "uh-empty", el("span", "uh-empty-icon", createIcon("cloud")),
    el("strong", undefined, "История временно недоступна"), el("p", undefined, "Попробуйте «Проверить обновления» чуть позже.")));
}
