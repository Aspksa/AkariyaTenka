import { updateOutcome, updateProgress, type UpdateEvent } from "./update-progress.js";
type UpdateStatus = {
  repository: string; branch: string; current: string | null;
  latest: string; updateAvailable: boolean | null; compareUrl: string;
  changes?: string[]; freeBytes?: number | null; enoughSpace?: boolean | null;
};
export function mountGithubUpdates(parent: HTMLElement): void {
  const message = document.createElement("p");
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Проверить обновления";
  button.className = "panel-button";
  const details = document.createElement("div");
  const link = document.createElement("a");
  link.target = "_blank"; link.rel = "noopener noreferrer";
  link.textContent = "Посмотреть изменения в GitHub";
  const install = document.createElement("button");
  install.type = "button"; install.className = "panel-button";
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
        action.textContent = "Вернуть версию " + backup.revision.slice(0,12);
        action.addEventListener("click", () => {
          if (!confirm("Вернуть предыдущую версию Akariya? Текущие файлы приложения будут сохранены в резервной копии. Пользовательские данные останутся на месте.")) return;
          action.disabled = true;
          const startedAt = Date.now();
          message.textContent = "Восстановление начато. Akariya перезапустится…";
          void fetch("/api/updates/rollback", {
            method:"POST",
            headers:{"content-type":"application/json","x-akariya-action":"github-rollback"},
            body:JSON.stringify({id:backup.id})
          }).then(response => {
            if (!response.ok) throw Error("Не удалось начать восстановление: HTTP " + response.status);
            message.textContent = "Ожидается перезапуск предыдущей версии…";
            void watchInstall(backup.revision, startedAt);
          }).catch(error => {message.textContent = String(error); action.disabled = false;});
        });
        rollbackList.append(action);
      }
      if (!rollbackList.childElementCount) rollbackList.textContent = "Доступных резервных копий пока нет.";
    } catch { rollbackList.textContent = "Не удалось загрузить список резервных копий."; }
  };
  const historyTitle = document.createElement("h3");
  historyTitle.textContent = "История обновлений";
  const historyList = document.createElement("ul");
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
  parent.append(button, message, details, link, whatsNew, space,
    install, later, progressBar, report, rollbackTitle, rollbackList, historyTitle, historyList);
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
  const historyLabels: Record<string, string> = {
    download_started: "Загрузка", validated: "Проверка сборки",
    prepared: "Установка подготовлена", confirmed: "Обновление подтверждено",
    rolled_back: "Откат", failed: "Ошибка обновления"
  };
  const loadHistory = async (): Promise<void> => {
    try {
      const response = await fetch("/api/updates/history", { cache: "no-store" });
      if (!response.ok) throw Error("History unavailable");
      const payload = await response.json() as {
        events?: { at: string; event: string; revision: string | null }[]
      };
      historyList.replaceChildren();
      const records = Array.isArray(payload.events) ? payload.events.slice(0, 12) : [];
      for (const record of records) {
        if (typeof record.at !== "string" || typeof record.event !== "string") continue;
        const item = document.createElement("li");
        const label = historyLabels[record.event] ?? "Событие";
        item.textContent = label + " · " + new Date(record.at).toLocaleString("ru-RU") +
          (record.revision && /^[0-9a-f]{40}$/.test(record.revision) ? " · " + record.revision.slice(0, 12) : "");
        historyList.append(item);
      }
      if (historyList.childElementCount === 0) {
        const empty = document.createElement("li");
        empty.textContent = "История пока пуста";
        historyList.append(empty);
      }
    } catch {
      historyList.replaceChildren();
      const error = document.createElement("li");
      error.textContent = "История временно недоступна";
      historyList.append(error);
    }
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
          installing = false;
          button.disabled = false;
          install.disabled = false;
          install.textContent = "Установить обновление";
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
    install.textContent = "Установить обновление";
  };
  install.addEventListener("click", () => {
    if (!approvedSha || installing) return;
    const sha = approvedSha;
    const startedAt = Date.now();
    installing = true;
    button.disabled = true;
    install.disabled = true;
    install.textContent = "Обновление выполняется…";
    progressBar.hidden = true;
    report.textContent = "";
    message.textContent = "Запускаю обновление. Не закрывайте AKARIYA.bat.";
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
          install.textContent = "Установить обновление";
          await check();
          if (approvedSha !== sha && !install.hidden)
            message.textContent = "На GitHub появилась более новая версия " + approvedSha?.slice(0, 12) +
              ". Проверьте изменения и нажмите «Установить обновление» ещё раз.";
          return;
        }
        if (!response.ok) {
          throw new Error("Установка отклонена (HTTP " + response.status + ")");
        }
      } catch (error) {
        // The backend intentionally shuts down after accepting the request.
        // A dropped HTTP connection does not necessarily mean installation failed.
        if (!(error instanceof TypeError)) {
          message.textContent = error instanceof Error ? error.message : String(error);
          installing = false;
          button.disabled = false;
          install.disabled = false;
          install.textContent = "Установить обновление";
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
    try {
      const response = await fetch("/api/updates/github", { cache: "no-store" });
      if (!response.ok) throw new Error("GitHub недоступен (HTTP " + response.status + ")");
      const state = await response.json() as UpdateStatus;
      if (!/^[a-f0-9]{40}$/i.test(state.latest)) throw new Error("Некорректная версия GitHub");
      approvedSha = state.latest;
      install.hidden = state.updateAvailable !== true;
      install.disabled = false;
      message.textContent = state.updateAvailable === true
        ? "Доступны изменения проекта на GitHub."
        : state.updateAvailable === false
        ? "Установлена актуальная версия."
        : "Текущая версия не определена. Автоматическое обновление недоступно.";
      details.textContent = "Локальная: " + (state.current?.slice(0, 12) ?? "неизвестна") +
        " · GitHub: " + state.latest.slice(0, 12);
      // The URL is generated from a pinned official repository and vetted SHA values.
      link.href = "https://github.com/Aspksa/AkariyaTenka/compare/" +
        (state.current && /^[a-f0-9]{40}$/i.test(state.current) ? state.current : state.latest) + "...main";
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
        item.textContent = "Описание изменений недоступно. Можно открыть сравнение в GitHub.";
        changesList.append(item);
      }
      if (typeof state.freeBytes === "number" && Number.isFinite(state.freeBytes)) {
        space.textContent = "Свободно на диске: " + Math.floor(state.freeBytes / 1048576) + " МиБ" +
          (state.enoughSpace === false ? " — недостаточно для безопасного обновления (нужно 768 МиБ)." : "");
      } else space.textContent = "Объём свободного места проверить не удалось.";
      install.hidden = state.updateAvailable !== true;
      install.disabled = state.enoughSpace === false;
      later.hidden = state.updateAvailable !== true || snoozed(state.latest);
      if (state.updateAvailable === true && snoozed(state.latest))
        message.textContent = "Есть обновление. Напоминание отложено; установить можно сейчас.";
    } catch (error) {
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
