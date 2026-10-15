import { createIcon, type IconName } from "../components/icons.js";
import { projectLifePanel } from "./project-life.js";
import { renderUpdateHistory, renderUpdateHistoryError, type HistoryEvent } from "./update-history.js";
import { updateOutcome, updateProgress, type UpdateEvent } from "./update-progress.js";
type UpdateStatus = {
  repository: string; branch: string; current: string | null;
  latest: string; updateAvailable: boolean | null; compareUrl: string;
  changes?: string[]; freeBytes?: number | null; enoughSpace?: boolean | null;
};
export function mountGithubUpdates(parent: HTMLElement): void {
 const notify=(id:string,kind:"update"|"error"|"info",title:string,detail:string):void=>{
  window.dispatchEvent(new CustomEvent("akariya-update-notice",{detail:{id,kind,title,detail}}));
 };
  const pendingKey="akariya-pending-update-v1";
  const track=(sha:string,startedAt:number,operation:"install"|"rollback"):void=>{
    try{localStorage.setItem(pendingKey,JSON.stringify({sha,startedAt,operation}));}catch{/* Storage unavailable */ }
  };
  const untrack=():void=>{try{localStorage.removeItem(pendingKey);}catch{/* Storage unavailable */}};
  const message = document.createElement("p");
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Проверить обновления";
  button.className = "panel-button";
  const details = document.createElement("div");
  const link = document.createElement("a");
  link.target = "_blank"; link.rel = "noopener noreferrer";
  link.textContent = "Посмотреть изменения в GitHub";
  const install = document.createElement("button");
  install.type = "button"; install.className = "panel-button primary";
  install.textContent = "Установить обновление"; install.hidden = true;
  const rollbackTitle = document.createElement("h3");
  rollbackTitle.textContent = "Вернуть предыдущую версию";
  const rollbackList = document.createElement("div");
  const loadBackups = async (): Promise<void> => {
    try {
      const response = await fetch("/api/updates/backups", {cache:"no-store"});
      if (!response.ok) throw Error("Backups unavailable");
      const payload = await response.json() as {backups?:{id:string;revision:string}[]};
      rollbackList.replaceChildren();
      const backups = Array.isArray(payload.backups) ? payload.backups.slice(0,3) : [];
      for (const backup of backups) {
        if (!/^[a-f0-9-]{36}$/i.test(backup.id) || !/^[a-f0-9]{40}$/.test(backup.revision)) continue;
        const action = document.createElement("button");
        action.className = "panel-button"; action.type = "button";
        const actionLabel = document.createElement("span");
        actionLabel.append("Вернуть версию ");
        const actionCode = document.createElement("code");
        actionCode.textContent = backup.revision.slice(0,12);
        actionLabel.append(actionCode);
        action.append(createIcon("history"), actionLabel);
        action.addEventListener("click", () => {
          if (!confirm("Вернуть предыдущую версию Akariya? Текущие файлы приложения будут сохранены в резервной копии. Пользовательские данные останутся на месте.")) return;
          action.disabled = true;
          const startedAt = Date.now();
          message.textContent = "Восстановление начато. Akariya перезапустится…";
          setState("busy");
          track(backup.revision,startedAt,"rollback");
          notify("rollback:state:"+backup.revision,"info","Запрошен откат","Akariya готовится восстановить предыдущую версию.");
          void fetch("/api/updates/rollback", {
            method:"POST",
            headers:{"content-type":"application/json","x-akariya-action":"github-rollback"},
            body:JSON.stringify({id:backup.id})
          }).then(response => {
            if (!response.ok) throw Error("Не удалось начать восстановление: HTTP " + response.status);
            message.textContent = "Ожидается перезапуск предыдущей версии…";
            void watchInstall(backup.revision, startedAt);
          }).catch(error => {message.textContent = String(error); action.disabled = false;
            untrack();
            notify("rollback:state:"+backup.revision,"error","Откат не запущен",String(error).slice(0,250));});
        });
        rollbackList.append(action);
      }
      if (!rollbackList.childElementCount) rollbackList.textContent = "Доступных резервных копий пока нет.";
    } catch { rollbackList.textContent = "Не удалось загрузить список резервных копий."; }
  };
  const historyTitle = document.createElement("h3");
  historyTitle.textContent = "История обновлений";
  const historyList = document.createElement("div");
  historyList.setAttribute("aria-label", "История обновлений Akariya");
  const whatsNew = document.createElement("section");
  const whatsNewTitle = document.createElement("h3");
  whatsNewTitle.textContent = "Что нового";
  const changesList = document.createElement("ul");
  whatsNew.append(whatsNewTitle, changesList);
  const space = document.createElement("p");
  const later = document.createElement("button");
  later.type = "button"; later.className = "panel-button";
  later.textContent = "Напомнить завтра"; later.hidden = true;
  const progressBar = document.createElement("progress");
  progressBar.max = 100; progressBar.hidden = true;
  progressBar.setAttribute("aria-label", "Загрузка обновления");
  const report = document.createElement("p");
  // Layout: a status card with the main actions, then "what's new", then backups and history.
  const block = (className: string, ...children: HTMLElement[]): HTMLElement => {
    const node = document.createElement("section");
    node.className = className;
    node.append(...children);
    return node;
  };
  message.className = "update-message";
  details.className = "update-versions";
  space.className = "update-space";
  report.className = "update-report";
  button.classList.add("ghost");
  const actions = block("update-actions", install, later, button);
  // Status orb: a large animated glyph that mirrors the current update state at a glance.
  const orb = document.createElement("span");
  orb.className = "update-orb"; orb.setAttribute("aria-hidden", "true");
  const kicker = document.createElement("span");
  kicker.className = "update-kicker"; kicker.textContent = "GitHub · main";
  const summaryText = block("update-summary-text", kicker, message, details);
  const summaryHead = block("update-summary-head", orb, summaryText);
  const summary = block("update-card update-summary", summaryHead, actions, progressBar, report, space);
  const setState = (state: "checking" | "available" | "current" | "unknown" | "error" | "busy"): void => {
    const glyph: Record<typeof state, IconName> = {
      checking: "refresh", available: "arrow-up", current: "check", unknown: "info", error: "alert", busy: "download"
    };
    summary.dataset.state = state;
    orb.replaceChildren(createIcon(glyph[state]));
  };
  setState("checking");
  const withIcon = (target: HTMLButtonElement, name: IconName): void => {
    const label = document.createElement("span");
    label.textContent = target.textContent;
    target.replaceChildren(createIcon(name), label);
  };
  withIcon(install, "download"); withIcon(later, "clock"); withIcon(button, "refresh");
  const setInstallLabel = (text: string): void => { install.lastElementChild!.textContent = text; };
  whatsNew.className = "update-card update-whats-new";
  whatsNewTitle.prepend(createIcon("sparkles"));
  rollbackTitle.prepend(createIcon("lifebuoy"));
  historyTitle.prepend(createIcon("history"));
  historyList.className = "update-history";
  link.className = "update-link";
  whatsNew.append(link);
  const backups = block("update-card", rollbackTitle, rollbackList);
  const history = block("update-card update-history-card", historyTitle, historyList);
  parent.classList.add("updates-page");
  // As in JUUNIBI: the update centre on the left, «Жизнь проекта» in a column on the right.
  parent.append(block("upd-layout", block("upd-main", summary, whatsNew, history, backups), projectLifePanel()));
  const snoozeKey = "akariya-update-snooze";
  function snoozed(sha: string): boolean {
    try {
      const item = JSON.parse(localStorage.getItem(snoozeKey) ?? "null") as {sha?: string; until?: number} | null;
      return item?.sha === sha && Number.isFinite(item.until) && (item.until ?? 0) > Date.now();
    } catch { return false; }
  }
  later.addEventListener("click", () => {
    if (!approvedSha) return;
    localStorage.setItem(snoozeKey, JSON.stringify({sha: approvedSha, until: Date.now() + 24 * 60 * 60 * 1000}));
    later.hidden = true;
    window.dispatchEvent(new Event("akariya-update-snooze"));
    message.textContent = "Обновление отложено до завтра. Вы можете установить его в любой момент.";
  });
  const loadHistory = async (): Promise<void> => {
    try {
      const response = await fetch("/api/updates/history", { cache: "no-store" });
      if (!response.ok) throw Error("History unavailable");
      const payload = await response.json() as { events?: HistoryEvent[] };
      renderUpdateHistory(historyList, (Array.isArray(payload.events) ? payload.events : [])
        .filter(e => e && typeof e.at === "string" && typeof e.event === "string"));
    } catch { renderUpdateHistoryError(historyList); }
  };
  let approvedSha: string | null = null;
  let installing = false;
  const watchInstall = async (sha: string, startedAt: number): Promise<void> => {
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline && parent.isConnected) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 2_000));
      try {
        const response = await fetch("/api/updates/history", {
          cache: "no-store", signal: AbortSignal.timeout(4_000)
        });
        if (!response.ok) continue;
        const payload = await response.json() as {
          events?: UpdateEvent[];
          progress?: {phase: string; received: number; total: number | null; startedAt: string}
        };
        const events = Array.isArray(payload.events) ? payload.events : [];
        const outcome = updateOutcome(events, sha, startedAt);
        if (outcome === "confirmed") {
          progressBar.hidden = true;
          report.textContent = "Версия " + sha.slice(0, 12) +
            " · Установка " + Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)) +
            " с · Проверка запуска пройдена";
          message.textContent = "Akariya успешно обновлена. Открываю новую версию…";
          untrack();
          notify("update:state:"+sha,"info","Обновление завершено","Новая версия "+sha.slice(0,12)+" успешно установлена.");
          window.location.reload();
          return;
        }
        if (outcome === "rolled_back" || outcome === "failed") {
          progressBar.hidden = true;
          report.textContent = "Обновление " + sha.slice(0, 12) + " · " +
            Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)) + " с · Не установлено";
          message.textContent = outcome === "rolled_back"
            ? "Обновление не удалось. Предыдущая версия восстановлена."
            : "Обновление не установлено. Проверьте журнал обновлений.";
          untrack();
          notify("update:state:"+sha,"error","Обновление не установлено",(message.textContent??"Проверьте историю обновлений.").slice(0,250));
          installing = false;
          button.disabled = false;
          install.disabled = false;
          setInstallLabel("Установить обновление");
          await loadHistory();
          return;
        }
        const progress = payload.progress;
        if (progress && Date.parse(progress.startedAt) >= startedAt - 2_000 && progress.phase === "downloading") {
          if (typeof progress.total === "number" && progress.total > 0) {
            const percent = Math.min(100, Math.floor(progress.received * 100 / progress.total));
            progressBar.value = percent; progressBar.hidden = false;
            message.textContent = "Загрузка из GitHub: " + percent + "%";
          } else {
            progressBar.hidden = true;
            message.textContent = "Загружено " + (progress.received / 1048576).toFixed(1) + " МиБ…";
          }
        } else {
          progressBar.hidden = true;
          message.textContent = updateProgress(events, sha, startedAt);
        }
      } catch {
        message.textContent = "Akariya перезапускается. Восстанавливаю соединение…";
      }
    }
    message.textContent = "Не удалось подтвердить обновление. Проверьте окно AKARIYA.bat, затем нажмите «Проверить обновления».";
    installing = false;
    button.disabled = false;
    install.disabled = false;
    setInstallLabel("Установить обновление");
  };
  install.addEventListener("click", () => {
    if (!approvedSha || installing) return;
    const sha = approvedSha;
    const startedAt = Date.now();
    installing = true;
    button.disabled = true;
    install.disabled = true;
    setInstallLabel("Обновление выполняется…");
    progressBar.hidden = true;
    report.textContent = "";
    message.textContent = "Запускаю обновление. Не закрывайте AKARIYA.bat.";
    setState("busy");
    track(sha,startedAt,"install");
    notify("update:state:"+sha,"info","Установка обновления","Начата установка версии "+sha.slice(0,12)+".");
    void (async () => {
      try {
        const response = await fetch("/api/updates/install", {
          method: "POST",
          headers: { "content-type": "application/json", "x-akariya-action": "github-install" },
          body: JSON.stringify({ sha })
        });
        if (response.status === 409) {
          // GitHub main changed (or the install became unnecessary) after the last check:
          // refresh so the user reviews and approves the revision that is current now.
          installing = false;
          setInstallLabel("Установить обновление");
          button.disabled = false;
          install.disabled = false;
          untrack();
          await check();
          if (approvedSha !== sha && !install.hidden)
            message.textContent = "На GitHub появилась более новая версия " + approvedSha?.slice(0, 12) +
              ". Проверьте изменения и нажмите «Установить обновление» ещё раз.";
          return;
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as {error?: {message?: string}} | null;
          throw new Error("Установка отклонена: " + (payload?.error?.message ?? "HTTP " + response.status));
        }
      } catch (error) {
        // The backend intentionally shuts down after accepting the request.
        // A dropped HTTP connection does not necessarily mean installation failed.
        if (error instanceof TypeError) {
          message.textContent = "Соединение потеряно. Проверяю, был ли принят запрос на обновление…";
          // A transport failure alone does not confirm acceptance; the progress watcher checks the server journal.
        } else {
          message.textContent = error instanceof Error ? error.message : String(error);
          untrack();
          notify("update:state:"+sha,"error","Установка отклонена",(message.textContent??"Не удалось запустить обновление.").slice(0,250));
          installing = false;
          button.disabled = false;
          install.disabled = false;
          setInstallLabel("Установить обновление");
          return;
        }
      }
      await watchInstall(sha, startedAt);
    })();
  });
  link.hidden = true;
  let inProgress = false;
  const check = async (): Promise<void> => {
    if (inProgress || installing) return;
    inProgress = true; button.disabled = true; install.hidden = true; message.textContent = "Проверка GitHub…";
    setState("checking");
    try {
      const response = await fetch("/api/updates/github", { cache: "no-store" });
      if (!response.ok) throw new Error("GitHub недоступен (HTTP " + response.status + ")");
      const state = await response.json() as UpdateStatus;
      if (!/^[a-f0-9]{40}$/i.test(state.latest)) throw new Error("Некорректная версия GitHub");
      approvedSha = state.latest;
      install.disabled = false;
      setState(state.updateAvailable === true ? "available" : state.updateAvailable === false ? "current" : "unknown");
      message.textContent = state.updateAvailable === true
        ? "Доступна новая версия Akariya."
        : state.updateAvailable === false
        ? "Установлена актуальная версия."
        : "Версия этой копии не определена. Можно установить последнюю версию с GitHub. " +
          "Текущие файлы сохранятся в резервной копии на диске, но вернуть их кнопкой отката нельзя: их версия неизвестна.";
      details.textContent = "Локальная: " + (state.current?.slice(0, 12) ?? "неизвестна") +
        " · GitHub: " + state.latest.slice(0, 12);
      // The URL is generated from a pinned official repository and vetted SHA values.
      // Without a known local base there is nothing to compare, so show the exact revision to be installed.
      const base = state.current && /^[a-f0-9]{40}$/i.test(state.current) ? state.current : null;
      link.href = "https://github.com/Aspksa/AkariyaTenka/" +
        (base ? "compare/" + base + "...main" : "tree/" + state.latest);
      link.textContent = base ? "Посмотреть изменения в GitHub" : "Открыть эту версию в GitHub";
      link.hidden = false;
      changesList.replaceChildren();
      const notes = (state.changes ?? []).slice(0, 8);
      for (const note of notes) {
        if (typeof note !== "string") continue;
        const item = document.createElement("li");
        item.textContent = note;
        changesList.append(item);
      }
      if (!changesList.childElementCount) {
        const item = document.createElement("li");
        item.textContent = base ? "Описание изменений недоступно. Можно открыть сравнение в GitHub."
          : "Список изменений недоступен: версия этой копии неизвестна.";
        changesList.append(item);
      }
      if (typeof state.freeBytes === "number" && Number.isFinite(state.freeBytes)) {
        space.textContent = "Свободно на диске: " + Math.floor(state.freeBytes / 1048576) + " МиБ" +
          (state.enoughSpace === false ? " — недостаточно для безопасного обновления (нужно 768 МиБ)." : "");
      } else space.textContent = "Объём свободного места проверить не удалось.";
      // An unknown local version can still install the reviewed latest revision.
      install.hidden = state.updateAvailable === false;
      setInstallLabel(state.updateAvailable === null ? "Установить последнюю версию" : "Установить обновление");
      install.disabled = state.enoughSpace === false;
      later.hidden = state.updateAvailable !== true || snoozed(state.latest);
      if (state.updateAvailable === true && snoozed(state.latest))
        message.textContent = "Есть обновление. Напоминание отложено; установить можно сейчас.";
    } catch (error) {
      setState("error");
      message.textContent = "Не удалось проверить обновления: " +
        (error instanceof Error ? error.message : String(error));
      link.hidden = true; install.hidden = true;
    } finally { inProgress = false; button.disabled = false; void loadHistory(); void loadBackups(); }
  };
  button.addEventListener("click", () => { void check(); });
  const intervalMs = 30 * 60 * 1000;
  window.setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, intervalMs);
  void check();
}
