import { createIcon, type IconName } from "./icons.js";

/**
 * The single notification bell: a panel with tabs and day groups, a settings view inside the same panel,
 * pop-up toasts, optional system notifications and a short chime. Everything lives in this browser
 * (localStorage) and is kept in sync between open tabs.
 */
export type NoticeKind = "update" | "error" | "info";
export interface Notice { id: string; kind: NoticeKind; title: string; detail: string; at: number; read: boolean; archived?: boolean }
export interface NoticeSettings {
  showUpdates: boolean; showErrors: boolean; showInfo: boolean;
  minimumPriority: "all" | "important" | "critical";
  /** Pop-up cards next to the bell for new notices. */
  toasts: boolean;
  /** Windows/macOS notifications while Akariya is in a background tab. */
  system: boolean;
  sound: boolean;
  /** No sound, toasts or system notifications; the bell still counts. */
  doNotDisturb: boolean;
  /** The same silence every night from 22:00 to 08:00. */
  quietHours: boolean;
  retentionDays: 7 | 30 | 90 | 0;
  density: "compact" | "expanded"; opacity: 70 | 85 | 100; fontScale: 90 | 100 | 115;
}
const KEY = "akariya-notifications-v1";
const SETTINGS_KEY = "akariya-notification-settings-v1";
const MAX_NOTICES = 300;
const DAY = 86_400_000;
export const defaultNoticeSettings: Readonly<NoticeSettings> = {
  showUpdates: true, showErrors: true, showInfo: true, minimumPriority: "all", toasts: true, system: false,
  sound: false, doNotDisturb: false, quietHours: false, retentionDays: 30, density: "expanded", opacity: 100, fontScale: 100
};

export function parseNoticeSettings(input: unknown): NoticeSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...defaultNoticeSettings };
  const v = input as Record<string, unknown>;
  const flag = (key: keyof NoticeSettings): boolean => typeof v[key] === "boolean" ? v[key] as boolean : defaultNoticeSettings[key] as boolean;
  return {
    showUpdates: flag("showUpdates"), showErrors: flag("showErrors"), showInfo: flag("showInfo"),
    minimumPriority: v.minimumPriority === "important" || v.minimumPriority === "critical" ? v.minimumPriority : "all",
    toasts: flag("toasts"), system: flag("system"), sound: flag("sound"), doNotDisturb: flag("doNotDisturb"), quietHours: flag("quietHours"),
    retentionDays: v.retentionDays === 7 || v.retentionDays === 90 || v.retentionDays === 0 ? v.retentionDays : 30,
    density: v.density === "compact" ? "compact" : "expanded",
    opacity: v.opacity === 70 || v.opacity === 85 ? v.opacity : 100,
    fontScale: v.fontScale === 90 || v.fontScale === 115 ? v.fontScale : 100
  };
}

export function parseNotices(value: unknown): Notice[] {
  if (!Array.isArray(value)) return [];
  const entries = value.filter((x): x is Notice => !!x && typeof x === "object" &&
    typeof x.id === "string" && /^[a-z0-9:-]{1,100}$/.test(x.id) &&
    ["update", "error", "info"].includes(x.kind) &&
    typeof x.title === "string" && x.title.length <= 120 &&
    typeof x.detail === "string" && x.detail.length <= 300 &&
    typeof x.at === "number" && Number.isFinite(x.at) && typeof x.read === "boolean" && (x.archived === undefined || typeof x.archived === "boolean"));
  const unique = new Map<string, Notice>();
  for (const item of entries) unique.set(item.id, item);
  return [...unique.values()].slice(-MAX_NOTICES);
}

/** Whether the owner's settings let this kind of notice appear at all (tabs aside). */
export function noticeAllowed(n: Pick<Notice, "kind">, s: NoticeSettings): boolean {
  const kindOn = n.kind === "update" ? s.showUpdates : n.kind === "error" ? s.showErrors : s.showInfo;
  const priorityOn = s.minimumPriority === "all" || n.kind === "error" || (s.minimumPriority === "important" && n.kind === "update");
  return kindOn && priorityOn;
}
/** Silence: «Не беспокоить», or the night between 22:00 and 08:00 when quiet hours are on. */
export function isQuiet(s: NoticeSettings, now = new Date()): boolean {
  const hour = now.getHours();
  return s.doNotDisturb || (s.quietHours && (hour >= 22 || hour < 8));
}
/** «только что», «5 мин назад», «3 ч назад», «вчера, 14:05» or a date. */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at), minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return minutes + " мин назад";
  const time = new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (dayLabel(at, now) === "Сегодня") return Math.floor(minutes / 60) + " ч назад";
  if (dayLabel(at, now) === "Вчера") return "вчера, " + time;
  return new Date(at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ", " + time;
}
/** Heading of the day group a notice belongs to. */
export function dayLabel(at: number, now = Date.now()): string {
  const start = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((start(now) - start(at)) / DAY);
  if (days <= 0) return "Сегодня";
  if (days === 1) return "Вчера";
  return new Date(at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children) if (c) node.append(c);
  return node;
}
function iconButton(icon: IconName, label: string, run: () => void, cls = "notification-icon-btn"): HTMLButtonElement {
  const b = el("button", cls, createIcon(icon));
  b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
  b.addEventListener("click", run);
  return b;
}
const KIND_ICON: Record<NoticeKind, IconName> = { update: "arrow-up", error: "alert", info: "info" };
const KIND_LABEL: Record<NoticeKind, string> = { update: "Обновление", error: "Ошибка", info: "Событие" };

export function createNotificationCenter(openUpdates: () => void) {
  const read = <T>(key: string, parse: (v: unknown) => T, fallback: string): T => {
    try { return parse(JSON.parse(localStorage.getItem(key) ?? fallback)); } catch { return parse(JSON.parse(fallback)); }
  };
  let notices = read(KEY, parseNotices, "[]");
  let settings = read(SETTINGS_KEY, parseNoticeSettings, "null");
  const save = (): void => { try { localStorage.setItem(KEY, JSON.stringify(notices)); } catch { /* no persistent storage */ } };
  const saveSettings = (): void => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* restricted */ } };

  /* ---------- bell ---------- */
  const wrapper = el("div", "notification-center");
  const toggle = el("button", "notification-toggle", createIcon("bell"));
  toggle.type = "button"; toggle.title = "Уведомления (правый клик — настройки)";
  toggle.setAttribute("aria-haspopup", "dialog"); toggle.setAttribute("aria-expanded", "false");
  const dot = el("span", "notification-severity-dot"); dot.hidden = true; dot.setAttribute("aria-hidden", "true");
  const count = el("span", "notification-count"); count.hidden = true; count.setAttribute("aria-hidden", "true");
  toggle.append(dot, count);

  /* ---------- panel: list view and settings view ---------- */
  const panel = el("section", "notification-panel");
  panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Центр уведомлений");
  const list = el("div", "notification-view");
  const prefs = el("div", "notification-view notification-prefs"); prefs.hidden = true;
  panel.append(list, prefs);
  const toasts = el("div", "notification-toasts"); toasts.setAttribute("aria-live", "polite");
  wrapper.append(toggle, panel);
  document.body.append(toasts);

  const headCount = el("span", "notification-head-count");
  const markAll = iconButton("check-all", "Отметить все прочитанными", () => { notices = notices.map(n => n.archived ? n : { ...n, read: true }); save(); draw(); });
  const head = el("header", "notification-head",
    el("div", "notification-head-title", el("strong", undefined, "Уведомления"), headCount),
    markAll, iconButton("settings", "Настройки уведомлений", () => showView("prefs")), iconButton("close", "Закрыть", () => close(true)));

  type Tab = "all" | "unread" | "important" | "archive";
  let activeTab: Tab = "all";
  const tabs = el("div", "notification-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Фильтр уведомлений");
  const tabButtons = new Map<Tab, { button: HTMLButtonElement; badge: HTMLSpanElement }>();
  for (const [key, label] of [["all", "Все"], ["unread", "Новые"], ["important", "Важные"], ["archive", "Архив"]] as const) {
    const badge = el("span", "notification-tab-count");
    const button = el("button", "notification-tab", label, badge);
    button.type = "button"; button.setAttribute("role", "tab");
    button.addEventListener("click", () => { activeTab = key; draw(); });
    tabButtons.set(key, { button, badge }); tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    const order = [...tabButtons.keys()], at = order.indexOf(activeTab);
    const next = event.key === "ArrowRight" ? order[(at + 1) % order.length] : event.key === "ArrowLeft" ? order[(at + order.length - 1) % order.length] : undefined;
    if (!next) return;
    event.preventDefault(); activeTab = next; draw(); tabButtons.get(next)!.button.focus();
  });
  const items = el("div", "notification-items");
  const undoBar = el("div", "notification-undo"); undoBar.hidden = true;
  const clear = el("button", "notification-footer-btn", createIcon("trash"), el("span"));
  clear.type = "button";
  const footer = el("footer", "notification-footer", clear);
  list.append(head, tabs, items, undoBar, footer);

  /* ---------- helpers ---------- */
  const allowed = (n: Notice): boolean => noticeAllowed(n, settings);
  const inTab = (n: Notice, tab: Tab): boolean => allowed(n) && (tab === "archive" ? !!n.archived
    : !n.archived && (tab !== "unread" || !n.read) && (tab !== "important" || n.kind !== "info"));
  const unreadCount = (): number => notices.filter(n => !n.read && !n.archived && allowed(n)).length;

  let undoTimer = 0;
  function offerUndo(removed: Notice[], text: string): void {
    window.clearTimeout(undoTimer);
    const restore = el("button", undefined, "Вернуть"); restore.type = "button";
    restore.addEventListener("click", () => {
      const ids = new Set(notices.map(n => n.id));
      notices = [...notices, ...removed.filter(n => !ids.has(n.id))].sort((a, b) => a.at - b.at).slice(-MAX_NOTICES);
      save(); undoBar.hidden = true; draw();
    });
    undoBar.replaceChildren(el("span", undefined, text), restore);
    undoBar.hidden = false;
    undoTimer = window.setTimeout(() => { undoBar.hidden = true; }, 8000);
  }
  clear.addEventListener("click", () => {
    // clears exactly what the current tab shows, and can be undone for a few seconds
    const removed = notices.filter(n => inTab(n, activeTab));
    if (!removed.length) return;
    const ids = new Set(removed.map(n => n.id));
    notices = notices.filter(n => !ids.has(n.id)); save(); draw();
    offerUndo(removed, "Удалено: " + removed.length);
  });

  function prune(): void {
    if (settings.retentionDays === 0) return;
    const cutoff = Date.now() - settings.retentionDays * DAY;
    const kept = notices.filter(n => n.at >= cutoff);
    if (kept.length !== notices.length) { notices = kept; save(); }
  }

  /* ---------- sound ---------- */
  let audio: AudioContext | null = null;
  const unlockAudio = (): void => {
    if (!settings.sound) return;
    try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { /* unsupported */ }
  };
  // browsers allow sound only after the person touched the page once; this keeps a saved «sound on» working after reloads
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });
  function chime(kind: NoticeKind, force = false): void {
    if (!force && (!settings.sound || isQuiet(settings))) return;
    try {
      unlockAudio();
      if (!audio || audio.state !== "running") return;
      const tones = kind === "error" ? [523, 392] : kind === "update" ? [660, 990] : [880];
      tones.forEach((f, i) => {
        const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * 0.16;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g).connect(audio!.destination);
        o.start(t); o.stop(t + 0.16);
      });
    } catch { /* audio blocked */ }
  }

  /* ---------- toasts and system notifications ---------- */
  function popup(n: Notice): void {
    if (isQuiet(settings) || !allowed(n)) return;
    if (settings.system && document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const sys = new Notification("Akariya · " + n.title, { body: n.detail, tag: n.id });
        sys.onclick = () => { window.focus(); if (n.kind === "update") openUpdates(); else open(); sys.close(); };
      } catch { /* blocked */ }
      return;
    }
    if (!settings.toasts || !panel.hidden) return;
    const card = el("div", "notification-toast notification-kind-" + n.kind);
    card.setAttribute("role", n.kind === "error" ? "alert" : "status");
    const body = el("div", "notification-toast-body", el("strong", undefined, n.title), el("p", undefined, n.detail));
    const actions = el("div", "notification-toast-actions");
    const action = el("button", "notification-toast-action", n.kind === "update" ? "Открыть обновления" : "Показать");
    action.type = "button";
    action.addEventListener("click", () => { remove(); if (n.kind === "update") openUpdates(); else open(); });
    actions.append(action);
    body.append(actions);
    const shut = iconButton("close", "Скрыть", () => remove(), "notification-icon-btn sm");
    card.append(el("span", "notification-kind-icon", createIcon(KIND_ICON[n.kind])), body, shut);
    let timer = window.setTimeout(() => remove(), 7000);
    card.addEventListener("pointerenter", () => window.clearTimeout(timer));
    card.addEventListener("pointerleave", () => { timer = window.setTimeout(() => remove(), 3000); });
    function remove(): void { window.clearTimeout(timer); card.classList.add("leaving"); window.setTimeout(() => card.remove(), 200); }
    toasts.prepend(card);
    while (toasts.childElementCount > 3) toasts.lastElementChild?.remove();
  }

  /* ---------- drawing ---------- */
  function row(n: Notice): HTMLElement {
    const article = el("article", "notification-item notification-kind-" + n.kind + (n.read ? "" : " unread"));
    const time = el("time", undefined, relativeTime(n.at)); time.dateTime = new Date(n.at).toISOString();
    time.title = new Date(n.at).toLocaleString("ru-RU");
    const body = el("div", "notification-item-body",
      el("div", "notification-item-top", el("strong", undefined, n.title), n.read ? null : el("span", "notification-unread-dot")),
      el("p", undefined, n.detail),
      el("div", "notification-item-meta", el("span", "notification-kind-label", KIND_LABEL[n.kind]), time));
    const percent = n.kind === "update" ? /(\d{1,3})%/u.exec(n.detail) : null;
    if (percent && Number(percent[1]) <= 100) {
      const progress = el("progress", "notification-progress"); progress.max = 100; progress.value = Number(percent[1]);
      progress.setAttribute("aria-label", "Прогресс " + percent[1] + "%"); body.append(progress);
    }
    if (n.kind === "update" && !n.archived) {
      const go = el("button", "notification-primary", "Открыть обновления"); go.type = "button";
      go.addEventListener("click", () => { notices = notices.map(x => x.id === n.id ? { ...x, read: true } : x); save(); close(false); openUpdates(); });
      body.append(el("div", "notification-item-actions", go));
    }
    // quick actions float over the corner on hover (always visible on touch screens)
    const actions = el("div", "notification-item-tools");
    if (!n.read && !n.archived) actions.append(iconButton("check", "Отметить прочитанным", () => { notices = notices.map(x => x.id === n.id ? { ...x, read: true } : x); save(); draw(); }));
    actions.append(iconButton(n.archived ? "history" : "archive", n.archived ? "Вернуть из архива" : "В архив", () => {
      notices = notices.map(x => x.id === n.id ? { ...x, archived: !x.archived, read: true } : x); save(); draw();
    }));
    actions.append(iconButton("trash", "Удалить", () => {
      notices = notices.filter(x => x.id !== n.id); save(); draw(); offerUndo([n], "Уведомление удалено");
    }));
    article.append(el("span", "notification-kind-icon", createIcon(KIND_ICON[n.kind])), body, actions);
    return article;
  }

  function draw(): void {
    const unread = unreadCount();
    count.hidden = unread === 0; count.textContent = unread > 99 ? "99+" : String(unread);
    const live = notices.filter(n => !n.read && !n.archived && allowed(n));
    const severity = live.some(n => n.kind === "error") ? "critical" : live.some(n => n.kind === "update") ? "warning" : "none";
    dot.hidden = severity === "none"; dot.dataset.severity = severity;
    toggle.setAttribute("aria-label", unread ? "Уведомления, непрочитанных: " + unread : "Уведомления");
    toggle.classList.toggle("is-quiet", isQuiet(settings));
    wrapper.dataset.density = settings.density;
    wrapper.style.setProperty("--notification-opacity", settings.opacity + "%");
    wrapper.style.setProperty("--notification-font-scale", String(settings.fontScale / 100));
    headCount.textContent = unread ? unread + " новых" : "всё прочитано";
    markAll.disabled = unread === 0;
    for (const [key, { button, badge }] of tabButtons) {
      const selected = key === activeTab;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
      const n = key === "unread" ? unread : notices.filter(x => inTab(x, key)).length;
      badge.textContent = n ? String(n) : "";
    }
    const visible = notices.filter(n => inTab(n, activeTab)).sort((a, b) => b.at - a.at);
    const nodes: HTMLElement[] = [];
    let group = "";
    for (const n of visible) {
      const label = dayLabel(n.at);
      if (label !== group) { group = label; nodes.push(el("h3", "notification-day", label)); }
      nodes.push(row(n));
    }
    if (!visible.length) nodes.push(el("div", "notification-empty",
      el("span", "notification-empty-icon", createIcon(activeTab === "archive" ? "archive" : "bell")),
      el("strong", undefined, activeTab === "archive" ? "Архив пуст" : activeTab === "unread" ? "Всё прочитано" : "Пока тихо"),
      el("p", undefined, activeTab === "archive" ? "Сюда попадают уведомления, отправленные в архив." : "Здесь появятся обновления, ошибки и события Akariya.")));
    items.replaceChildren(...nodes);
    clear.lastElementChild!.textContent = activeTab === "archive" ? "Очистить архив" : "Очистить список";
    clear.disabled = !visible.length;
  }

  /* ---------- settings view ---------- */
  function drawPrefs(): void {
    const set = <K extends keyof NoticeSettings>(key: K, value: NoticeSettings[K]): void => {
      settings = { ...settings, [key]: value }; saveSettings();
      if (key === "retentionDays") prune();
      if (key === "sound" && value) unlockAudio();
      draw(); drawPrefs();
    };
    const sw = (key: "showUpdates" | "showErrors" | "showInfo" | "toasts" | "system" | "sound" | "doNotDisturb" | "quietHours", icon: IconName, title: string, hint: string, extra?: Child): HTMLElement => {
      const input = el("input"); input.type = "checkbox"; input.checked = settings[key]; input.setAttribute("role", "switch");
      input.addEventListener("change", () => {
        if (key === "system" && input.checked) {
          if (typeof Notification === "undefined") { input.checked = false; systemNote.textContent = "Этот браузер не поддерживает системные уведомления."; return; }
          void Notification.requestPermission().then(p => {
            if (p !== "granted") { systemNote.textContent = "Браузер не разрешил уведомления. Разрешите их в настройках сайта."; set("system", false); }
            else set("system", true);
          });
          return;
        }
        set(key, input.checked);
      });
      return el("label", "notification-switch", el("span", "notification-pref-icon", createIcon(icon)),
        el("span", "notification-pref-text", el("strong", undefined, title), el("small", undefined, hint), extra), input, el("span", "notification-switch-track"));
    };
    const segmented = <K extends "minimumPriority" | "retentionDays" | "density" | "opacity" | "fontScale">(key: K, title: string, options: readonly [NoticeSettings[K], string][]): HTMLElement => {
      const group = el("div", "notification-segmented"); group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", title);
      for (const [value, label] of options) {
        const b = el("button", undefined, label); b.type = "button"; b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(settings[key] === value));
        b.addEventListener("click", () => set(key, value));
        group.append(b);
      }
      return el("div", "notification-pref-row", el("span", "notification-pref-label", title), group);
    };
    const systemNote = el("small", "notification-pref-note");
    if (settings.system && typeof Notification !== "undefined" && Notification.permission !== "granted") systemNote.textContent = "Разрешение браузера отозвано — включите заново.";
    const test = el("button", "notification-link", "Проверить звук"); test.type = "button";
    test.addEventListener("click", (event) => { event.preventDefault(); unlockAudio(); window.setTimeout(() => chime("update", true), 60); });
    const reset = el("button", "notification-footer-btn", createIcon("refresh"), el("span", undefined, "Сбросить настройки")); reset.type = "button";
    reset.addEventListener("click", () => { settings = { ...defaultNoticeSettings }; saveSettings(); draw(); drawPrefs(); });
    const back = iconButton("chevron-left", "Назад к уведомлениям", () => showView("list"));
    const section = (title: string, ...kids: HTMLElement[]): HTMLElement => el("section", "notification-pref-section", el("h3", undefined, title), ...kids);
    prefs.replaceChildren(
      el("header", "notification-head", back, el("div", "notification-head-title", el("strong", undefined, "Настройки уведомлений"),
        el("span", "notification-head-count", isQuiet(settings) ? "сейчас тихо" : "звук и окна включены по настройкам")), iconButton("close", "Закрыть", () => close(true))),
      el("div", "notification-prefs-body",
        section("Что показывать",
          sw("showUpdates", "arrow-up", "Обновления", "Новая версия Akariya на GitHub"),
          sw("showErrors", "alert", "Ошибки", "Сбои обновления и соединения"),
          sw("showInfo", "info", "События", "Установка завершена, откат и прочее"),
          segmented("minimumPriority", "Важность", [["all", "Все"], ["important", "Важные"], ["critical", "Критичные"]])),
        section("Как сообщать",
          sw("toasts", "bell", "Всплывающие окна", "Карточка у колокольчика на 7 секунд"),
          sw("system", "monitor", "Системные уведомления", "Когда Akariya в фоновой вкладке", systemNote),
          sw("sound", "volume", "Звук", "Короткий сигнал, у ошибки — ниже", test)),
        section("Тишина",
          sw("doNotDisturb", "bell-off", "Не беспокоить", "Без звука и окон, счётчик продолжает считать"),
          sw("quietHours", "moon", "Тихие часы", "Каждую ночь с 22:00 до 08:00")),
        section("Хранение и вид",
          segmented("retentionDays", "Хранить", [[7, "7 дн"], [30, "30 дн"], [90, "90 дн"], [0, "Всегда"]]),
          segmented("density", "Карточки", [["expanded", "Подробно"], ["compact", "Компактно"]]),
          segmented("fontScale", "Текст", [[90, "Мелкий"], [100, "Обычный"], [115, "Крупный"]]),
          segmented("opacity", "Фон панели", [[70, "70%"], [85, "85%"], [100, "100%"]]))),
      el("footer", "notification-footer", reset));
  }

  /* ---------- open / close ---------- */
  function showView(view: "list" | "prefs"): void {
    list.hidden = view !== "list"; prefs.hidden = view !== "prefs";
    if (view === "prefs") drawPrefs(); else draw();
    (view === "prefs" ? prefs : list).querySelector<HTMLElement>("button")?.focus();
  }
  function open(view: "list" | "prefs" = "list"): void {
    for (const t of [...toasts.children]) t.remove();
    panel.hidden = false; toggle.setAttribute("aria-expanded", "true");
    showView(view);
  }
  function close(focus: boolean): void {
    if (panel.hidden) return;
    panel.hidden = true; toggle.setAttribute("aria-expanded", "false");
    if (focus) toggle.focus();
  }
  toggle.addEventListener("click", () => { if (panel.hidden) open(); else close(false); });
  toggle.addEventListener("contextmenu", (event) => { event.preventDefault(); open("prefs"); });
  wrapper.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); close(true); } });
  document.addEventListener("pointerdown", (event) => { if (!wrapper.contains(event.target as Node)) close(false); });

  // other tabs of Akariya write the same storage: follow them instead of overwriting their changes
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) notices = read(KEY, parseNotices, "[]");
    else if (event.key === SETTINGS_KEY) { settings = read(SETTINGS_KEY, parseNoticeSettings, "null"); if (!prefs.hidden) drawPrefs(); }
    else return;
    draw();
  });
  // relative times («5 мин назад») and quiet hours move on by themselves
  window.setInterval(() => { if (!panel.hidden && !list.hidden) draw(); else toggle.classList.toggle("is-quiet", isQuiet(settings)); }, 60_000);

  prune(); draw();
  return {
    element: wrapper,
    notify(item: Omit<Notice, "read" | "at"> & { at?: number }) {
      const old = notices.find(n => n.id === item.id);
      if (old && old.title === item.title && old.detail === item.detail) return;
      const notice: Notice = { ...item, at: item.at ?? Date.now(), read: false };
      notices = [...notices.filter(n => n.id !== item.id), notice].slice(-MAX_NOTICES);
      prune(); save(); draw();
      if (!old) { popup(notice); if (allowed(notice)) chime(notice.kind); }
    },
    dismiss(prefix: string) {
      const previous = notices.length;
      notices = notices.filter(n => !n.id.startsWith(prefix));
      if (previous !== notices.length) { save(); draw(); }
    }
  };
}
