type Mode = "ssd" | "computer" | "compare" | "restore";
const actions: { id: Mode; title: string; description: string }[] = [
  { id: "ssd", title: "На SSD", description: "Проверить перенос изменений с компьютера на SSD. Применение возможно только после остановки Akariya." },
  { id: "computer", title: "На компьютер", description: "Создать новую локальную копию либо проверить изменения SSD → ПК." },
  { id: "compare", title: "Сравнить", description: "Показать независимые изменения и конфликты без записи данных." },
  { id: "restore", title: "Восстановить", description: "Восстановить резервную копию только в отдельную, ещё не существующую папку." }
];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function quote(value: string) {
  if (!value.trim() || /[\r\n\0]/.test(value)) throw Error("Укажите путь или идентификатор без перевода строки.");
  return "'" + value.replaceAll("'", "''") + "'";
}
function generate(mode: Mode, source: string, target: string, backupId: string, fresh: boolean) {
  const a = quote(source), b = quote(target);
  if (mode === "compare") return "node scripts/portable-state.mjs compare " + a + " " + b;
  if (mode === "restore") return "node scripts/portable-restore.mjs restore " + a + " " + quote(backupId) + " " + b + " --stopped";
  if (mode === "computer" && fresh) return "node scripts/portable-transfer.mjs copy " + a + " " + b;
  return "node scripts/portable-replace.mjs plan " + a + " " + b;
}
export function mountPortableActions(panel: HTMLElement): void {
  panel.replaceChildren();
  const heading = el("h2", "Перенос Akariya");
  const notice = el("p", "Безопасный режим: здесь формируются команды для запуска после полного завершения Akariya. Из работающего веб-интерфейса перенос и перезапись запрещены.");
  const status = el("p", "Проверка состояния…");
  const buttons = el("div");
  buttons.className = "status-row";
  const message = el("p", "");
  message.setAttribute("role", "status");
  const source = el("input") as HTMLInputElement;
  source.type = "text"; source.placeholder = "Исходная папка (например C:\\AkariyaTenka)";
  source.setAttribute("aria-label", "Исходная папка");
  const target = el("input") as HTMLInputElement;
  target.type = "text"; target.placeholder = "Папка назначения (например E:\\AkariyaTenka)";
  target.setAttribute("aria-label", "Папка назначения");
  const id = el("input") as HTMLInputElement;
  id.type = "text"; id.placeholder = "ID резервной копии";
  id.setAttribute("aria-label", "Идентификатор резервной копии");
  const freshLabel = el("label");
  const fresh = el("input") as HTMLInputElement;
  fresh.type = "checkbox"; freshLabel.append(fresh, document.createTextNode(" Новая копия: папка назначения ещё не существует"));
  const output = el("pre"); output.style.whiteSpace = "pre-wrap";
  const approval=el("input") as HTMLInputElement;
  approval.type="text";
  approval.placeholder="Для выполнения введите ПЕРЕНЕСТИ";
  approval.setAttribute("aria-label","Подтверждение переноса");
  const execute=el("button","Выполнить через Akariya");
  execute.type="button";
  const applyNote=el("p","Встроенный перенос работает только под контролем launcher. Akariya остановится, сохранит данные, выполнит действие и откроется снова. При конфликте перенос будет отклонён.");
  let currentRoot="";
  const normalize=(value:string)=>value.trim().replace(/[\\/]+$/,"").replaceAll("/","\\").toLowerCase();
  execute.addEventListener("click",()=>{
    const from=source.value.trim(),to=target.value.trim();
    if(approval.value!=="ПЕРЕНЕСТИ" || !currentRoot) {
      message.textContent="Укажите подтверждение ПЕРЕНЕСТИ и дождитесь загрузки статуса.";
      return;
    }
    let action: "compare"|"copy"|"sync-to"|"sync-from"|"restore";
    let other="";
    const fromCurrent=normalize(from)===normalize(currentRoot);
    const toCurrent=normalize(to)===normalize(currentRoot);
    if(fromCurrent===toCurrent){
      message.textContent="Один из двух путей должен совпадать с папкой запущенной Akariya.";
      return;
    }
    if(selected==="compare"){
      action="compare";other=fromCurrent?to:from;
    }else if(selected==="restore"){
      if(!fromCurrent){message.textContent="Для восстановления исходная папка должна быть текущей установкой.";return;}
      action="restore";other=to;
    }else if(selected==="computer" && fresh.checked){
      if(!fromCurrent){message.textContent="Для новой копии источником должна быть запущенная Akariya.";return;}
      action="copy";other=to;
    }else{
      action=fromCurrent?"sync-to":"sync-from";other=fromCurrent?to:from;
    }
    if(!window.confirm("Akariya будет закрыта для безопасного переноса. Продолжить?"))return;
    execute.disabled=true;
    message.textContent="Передача запроса launcher…";
    void fetch("/api/portable/action",{
      method:"POST",
      headers:{"content-type":"application/json","x-akariya-action":"portable"},
      body:JSON.stringify({action,other,confirm:"ПЕРЕНЕСТИ",...(action==="restore"?{backupId:id.value.trim()}:{})})
    }).then(async response=>{
      if(!response.ok)throw Error("Сервер отклонил запрос (HTTP "+response.status+").");
      message.textContent="Запрос принят. Akariya завершает работу и выполнит перенос после остановки. Результат появится после повторного запуска.";
    }).catch((error:unknown)=>{
      execute.disabled=false;
      message.textContent=error instanceof Error?error.message:String(error);
    });
  });
  const copy = el("button", "Копировать команду");
  copy.type = "button"; copy.disabled = true;
  let command = "";
  copy.addEventListener("click", () => {
    if (!command) return;
    void navigator.clipboard.writeText(command)
      .then(() => { message.textContent = "Команда скопирована. Запустите её в PowerShell после остановки всех экземпляров Akariya."; })
      .catch(() => { message.textContent = "Автоматическое копирование недоступно. Выделите команду и скопируйте вручную."; });
  });
  let selected: Mode = "compare";
  const instructions = el("p");
  function render() {
    const action = actions.find(x => x.id === selected);
    instructions.textContent = action?.description ?? "";
    id.hidden = selected !== "restore";
    freshLabel.hidden = selected !== "computer";
    try {
      command = generate(selected, source.value, target.value, id.value, fresh.checked);
      output.textContent = command;
      copy.disabled = false;
      message.textContent = selected === "computer" && fresh.checked
        ? "Команда создания копии запрещает замену существующей папки."
        : "Команда не выполняется автоматически. Сначала проверьте пути и остановите Akariya.";
    } catch {
      command = ""; output.textContent = "Укажите исходную папку, папку назначения" + (selected === "restore" ? " и ID резервной копии." : ".");
      copy.disabled = true;
    }
  }
  for (const action of actions) {
    const button = el("button", action.title);
    button.type = "button";
    button.addEventListener("click", () => {
      selected = action.id;
      for (const other of buttons.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
      render();
    });
    button.setAttribute("aria-pressed", String(action.id === selected));
    buttons.append(button);
  }
  for (const input of [source,target,id,fresh]) input.addEventListener("input", render);
  panel.append(heading,notice,status,buttons,instructions,source,target,id,freshLabel,output,copy,applyNote,approval,execute,message);
  render();
  void fetch("/api/portable/status", { cache: "no-store" })
    .then(async response => { if (!response.ok) throw Error("Статус недоступен"); return response.json() as Promise<Record<string, unknown>>; })
    .then(data => {
      currentRoot=typeof data.projectRoot==="string"?data.projectRoot:"";
      if(currentRoot && !source.value)source.value=currentRoot;
      render();
      const previous=data.lastTransfer;
      if(previous && typeof previous==="object" && "status" in previous){
        const result=previous as Record<string,unknown>;
        message.textContent=result.status==="success"
          ?"Последний перенос завершён успешно."
          :"Последний перенос не выполнен: "+String(result.error??"неизвестная ошибка");
      }
      status.textContent = "Установка: " + (data.installationId ?? "не настроена") +
        " · Снимок: " + (data.baseline ? "есть" : "нет") +
        " · Синхронизация: " + (data.syncLocked ? "занята" : "свободна");
    })
    .catch(error => { status.textContent = error instanceof Error ? error.message : String(error); });
}
