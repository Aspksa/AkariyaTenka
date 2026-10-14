type UpdateStatus = {
  repository: string; branch: string; current: string | null;
  latest: string; updateAvailable: boolean | null; compareUrl: string;
};
export function mountGithubUpdates(parent: HTMLElement): void {
  const message = document.createElement("p");
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Проверить обновления";
  button.className = "nav-item";
  const details = document.createElement("div");
  const link = document.createElement("a");
  link.target = "_blank"; link.rel = "noopener noreferrer";
  link.textContent = "Посмотреть изменения в GitHub";
  const install = document.createElement("button");
  install.type = "button"; install.className = "nav-item";
  install.textContent = "Установить обновление"; install.hidden = true;
  const historyTitle = document.createElement("h3");
  historyTitle.textContent = "История обновлений";
  const historyList = document.createElement("ul");
  historyList.setAttribute("aria-label", "История обновлений Akariya");
  parent.append(button, message, details, link, install, historyTitle, historyList);
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
  install.addEventListener("click", () => {
    if (!approvedSha || !confirm("Установить обновление Akariya из GitHub? Приложение перезапустится. Локальные данные будут сохранены.")) return;
    install.disabled = true;
    void fetch("/api/updates/install", {
      method: "POST", headers: { "content-type": "application/json", "x-akariya-action": "github-install" },
      body: JSON.stringify({ sha: approvedSha })
    }).then(async response => {
      if (!response.ok) throw new Error("Запрос отклонён (HTTP " + response.status + ")");
      message.textContent = "Установка запущена. Проверьте окно AKARIYA.bat; приложение перезапустится.";
    }).catch(error => { message.textContent = String(error); install.disabled = false; });
  });
  link.hidden = true;
  let inProgress = false;
  const check = async (): Promise<void> => {
    if (inProgress) return;
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
    } catch (error) {
      message.textContent = "Не удалось проверить обновления: " +
        (error instanceof Error ? error.message : String(error));
      link.hidden = true; install.hidden = true;
    } finally { inProgress = false; button.disabled = false; void loadHistory(); }
  };
  button.addEventListener("click", () => { void check(); });
  const intervalMs = 30 * 60 * 1000;
  window.setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, intervalMs);
  void check();
}
