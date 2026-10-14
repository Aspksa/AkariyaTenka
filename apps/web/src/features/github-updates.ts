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
  parent.append(button, message, details, link, install);
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
      install.hidden = state.updateAvailable === false;
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
    } finally { inProgress = false; button.disabled = false; }
  };
  void check();
}
