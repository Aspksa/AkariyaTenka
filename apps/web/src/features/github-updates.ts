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
        action.textContent = "Вернуть версию " + backup.revision.slice(0,12);
        action.addEventListener("click", () => {
          if (!confirm("Вернуть предыдущую версию Akariya? Текущие файлы приложения будут сохранены в резервной копии. Пользовательские данные останутся на месте.")) return;
          action.disabled = true;
          const startedAt = Date.now();
          message.textContent = "Восстановление начато. Akariya перезапустится…";
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
  const summary = block("update-card update-summary", message, details, actions, progressBar, report, space);
  whatsNew.className = "update-card";
  whatsNew.append(link);
  const backups = block("update-card", rollbackTitle, rollbackList);
  const history = block("update-card", historyTitle, historyList);
  parent.classList.add("updates-page");
  parent.append(summary, whatsNew, block("update-grid", backups, history));
  const statistics=document.createElement("section");statistics.className="update-card";
  const statsTitle=document.createElement("h3");statsTitle.textContent="📚 История проекта в цифрах";
  const statsNote=document.createElement("p");statsNote.textContent="Расчёт по истории Git и текущим файлам. Загрузка…";
  const statsGrid=document.createElement("div");statsGrid.className="akariya-git-stat-grid";
  const refreshStats=document.createElement("button");refreshStats.type="button";refreshStats.className="panel-button ghost";refreshStats.textContent="Обновить статистику";
  statistics.append(statsTitle,statsNote,refreshStats,statsGrid);
  parent.insertBefore(statistics,parent.lastElementChild);
  const displayNumber=(v:number|null|undefined)=>typeof v==="number"?v.toLocaleString("ru-RU"):"Нет данных";
  const showMetric=(symbol:string,title:string,value:string,description:string):void=>{
    const box=document.createElement("article");box.className="akariya-git-stat";
    const heading=document.createElement("strong");heading.textContent=symbol+" "+title;
    const metric=document.createElement("p");metric.className="akariya-git-stat-value";metric.textContent=value;
    const detail=document.createElement("small");detail.textContent=description;
    box.append(heading,metric,detail);statsGrid.append(box);
  };
  let loadingStats=false;
  const loadStatistics=async():Promise<void>=>{
    if(loadingStats)return;loadingStats=true;refreshStats.disabled=true;statsNote.textContent="Подсчёт Git-статистики…";
    try{
      const res=await fetch("/api/updates/statistics",{cache:"no-store",signal:AbortSignal.timeout(60000)});
      if(!res.ok)throw Error("HTTP "+res.status);
      const data=await res.json() as {
        available:boolean;reason?:string;wordsAdded:number|null;wordsDeleted:number|null;wordsRewritten:number|null;
        newFiles:number|null;deletedFiles:number|null;largestFile:{path:string;lines:number}|null;
        smallestCodeFile:{path:string;lines:number}|null;oldestUntouchedFile:{path:string;lastChanged:string}|null;
        hottestFile:{path:string;commits:number}|null;biggestGrowth:{path:string;netLines:number}|null;
        languages:{extension:string;lines:number}[];averageCodeLines:number|null;medianCodeLines:number|null;
        directories:number;averageFilesPerDirectory:number;markdownLines:number;jsonFiles:number;jsonBytes:number;
      };
      statsGrid.replaceChildren();
      statsNote.textContent=data.available?"История: вся доступная локальная Git-история. Текущие файлы: отслеживаемые Git.":data.reason??"История Git недоступна";
      showMetric("🌱","Сколько слов родилось",displayNumber(data.wordsAdded),"Добавленные слова в Git word-diff");
      showMetric("✂️","Сколько слов исчезло",displayNumber(data.wordsDeleted),"Удалённые слова в Git word-diff");
      showMetric("🔄","Переписанная история",displayNumber(data.wordsRewritten),"Оценка заменённых слов по блокам diff");
      showMetric("🍼","Новорождённые файлы",displayNumber(data.newFiles),"Git-события добавления файлов");
      showMetric("💀","Кладбище файлов",displayNumber(data.deletedFiles),"Git-события удаления файлов");
      showMetric("🏋️","Файл-гигант",data.largestFile?data.largestFile.lines+" строк": "Нет данных",data.largestFile?.path??"");
      showMetric("🐜","Самый маленький",data.smallestCodeFile?data.smallestCodeFile.lines+" строк":"Нет данных",data.smallestCodeFile?.path??"");
      showMetric("🏚️","Старожил проекта",data.oldestUntouchedFile?new Date(data.oldestUntouchedFile.lastChanged).toLocaleDateString("ru-RU"):"Нет данных",data.oldestUntouchedFile?.path??"");
      showMetric("🔥","Горячий файл",data.hottestFile?displayNumber(data.hottestFile.commits)+" изменений":"Нет данных",data.hottestFile?.path??"");
      showMetric("🌱","Самый выросший",data.biggestGrowth?displayNumber(data.biggestGrowth.netLines)+" строк":"Нет данных",data.biggestGrowth?.path??"");
      showMetric("🎨","Языки проекта",data.languages.slice(0,8).map(x=>x.extension+" "+displayNumber(x.lines)).join(" · ")||"Нет данных","Строки по расширениям в текущем коде");
      showMetric("📏","Средний файл",displayNumber(data.averageCodeLines)+" / "+displayNumber(data.medianCodeLines),"Среднее / медиана строк кода");
      showMetric("🗂️","Папки",displayNumber(data.directories),displayNumber(data.averageFilesPerDirectory)+" файлов на каталог в среднем");
      showMetric("📝","Документация",displayNumber(data.markdownLines)+" строк","Текущие файлы .md");
      showMetric("🗃️","Данные JSON",displayNumber(data.jsonFiles)+" файлов",displayNumber(data.jsonBytes)+" байт");
    }catch(e){statsNote.textContent="Не удалось получить статистику: "+(e instanceof Error?e.message:String(e));}
    finally{loadingStats=false;refreshStats.disabled=false;}
  };
  refreshStats.addEventListener("click",()=>{void loadStatistics();});

  const deepSection=document.createElement("section");deepSection.className="update-card";
  const deepHeading=document.createElement("h3");deepHeading.textContent="🔬 Углублённая аналитика проекта";
  const deepStatus=document.createElement("p");deepStatus.textContent="История, код и измерения обновлений";
  const deepRefresh=document.createElement("button");deepRefresh.type="button";deepRefresh.className="panel-button ghost";deepRefresh.textContent="Рассчитать дополнительные показатели";
  const deepGroups=document.createElement("div");
  deepSection.append(deepHeading,deepStatus,deepRefresh,deepGroups);
  parent.insertBefore(deepSection,parent.lastElementChild);
  let deepPending=false;
  async function loadDeep():Promise<void>{
   if(deepPending)return;deepPending=true;deepRefresh.disabled=true;deepStatus.textContent="Вычисление показателей…";
   try{
    const response=await fetch("/api/updates/statistics/deep",{cache:"no-store",signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw Error("HTTP "+response.status);
    const data=await response.json() as {sections?:{title:string;metrics:{label:string;value:string|null;detail:string}[]}[];caveats?:string[]};
    deepGroups.replaceChildren();
    for(const section of data.sections??[]){
      const heading=document.createElement("h4");heading.textContent=section.title;deepGroups.append(heading);
      const grid=document.createElement("div");grid.className="akariya-git-stat-grid";
      for(const record of section.metrics??[]){
        const tile=document.createElement("article");tile.className="akariya-git-stat";
        const name=document.createElement("strong");name.textContent=record.label;
        const value=document.createElement("p");value.className="akariya-git-stat-value";value.textContent=record.value??"Нет данных";
        const description=document.createElement("small");description.textContent=record.detail;
        tile.append(name,value,description);grid.append(tile);
      }
      deepGroups.append(grid);
    }
    deepStatus.textContent=(data.caveats??[]).join(" ");
   }catch(error){deepStatus.textContent="Не удалось рассчитать показатели: "+(error instanceof Error?error.message:String(error));}
   finally{deepPending=false;deepRefresh.disabled=false;}
  }
  deepRefresh.addEventListener("click",()=>{void loadDeep();});
  void loadDeep();
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
          install.textContent = "Установить обновление";
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
      install.disabled = false;
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
      install.textContent = state.updateAvailable === null ? "Установить последнюю версию" : "Установить обновление";
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
  void loadStatistics();
}
