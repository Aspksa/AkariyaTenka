/** Local-first personal tasks. No network access or hidden automation. */
export type TaskStatus="todo"|"doing"|"done";
export type TaskPriority="low"|"normal"|"high";
export interface Task {id:string;title:string;notes:string;status:TaskStatus;priority:TaskPriority;due:string;createdAt:number;updatedAt:number}
const KEY="akariya-dela-v1";
const statuses:TaskStatus[]=["todo","doing","done"];
const priorities:TaskPriority[]=["low","normal","high"];
export function parseTasks(value:unknown):Task[]{
 if(!Array.isArray(value))return [];
 const ids=new Set<string>();const result:Task[]=[];
 for(const v of value){
  if(!v||typeof v!=="object")continue;
  const t=v as Partial<Task>;
  if(typeof t.id!=="string"||!/^[a-zA-Z0-9-]{1,80}$/.test(t.id)||ids.has(t.id)||
     typeof t.title!=="string"||!t.title.trim()||t.title.length>160||
     typeof t.notes!=="string"||t.notes.length>2000||
     !statuses.includes(t.status as TaskStatus)||!priorities.includes(t.priority as TaskPriority)||
     typeof t.due!=="string"||(t.due!==""&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(t.due))||
     typeof t.createdAt!=="number"||!Number.isFinite(t.createdAt)||
     typeof t.updatedAt!=="number"||!Number.isFinite(t.updatedAt))continue;
  ids.add(t.id);result.push(t as Task);
  if(result.length>=500)break;
 }
 return result;
}
export function dueState(task:Pick<Task,"due"|"status">,today:string):"overdue"|"today"|"future"|"none"{
 if(!task.due||task.status==="done")return "none";
 return task.due<today?"overdue":task.due===today?"today":"future";
}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,cls="",text?:string):HTMLElementTagNameMap[K]{
 const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;
}
export function mountDela(host:HTMLElement):void{
 host.replaceChildren();
 let tasks:Task[]=[];
 try{tasks=parseTasks(JSON.parse(localStorage.getItem(KEY)??"[]"));}catch{/* unavailable storage */}
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(tasks));return true;}catch{return false;}};
 const root=node("section","dela");
 const head=node("div","dela-head");
 const intro=node("div");intro.append(node("h3","","Дела"),node("p","","Задачи, планы и выполненная работа"));
 const stats=node("div","dela-stats");head.append(intro,stats);
 const form=node("form","dela-form");
 const title=node("input");title.placeholder="Новое дело…";title.required=true;title.maxLength=160;title.setAttribute("aria-label","Название дела");
 const notes=node("textarea");notes.placeholder="Описание или заметки";notes.maxLength=2000;notes.rows=2;notes.setAttribute("aria-label","Описание дела");
 const priority=node("select");priority.setAttribute("aria-label","Приоритет");
 for(const [value,label] of [["normal","Обычный"],["high","Высокий"],["low","Низкий"]]){const o=node("option","",label);o.value=value;priority.append(o);}
 const due=node("input");due.type="date";due.setAttribute("aria-label","Срок выполнения");
 const add=node("button","","Добавить дело");add.type="submit";
 const formFields=node("div","dela-form-fields");formFields.append(priority,due,add);form.append(title,notes,formFields);
 const toolbar=node("div","dela-toolbar");
 const filter=node("select");filter.setAttribute("aria-label","Фильтр дел");
 for(const [value,label] of [["all","Все"],["todo","Запланированы"],["doing","В работе"],["done","Выполнены"],["overdue","Просрочены"]]){const o=node("option","",label);o.value=value;filter.append(o);}
 const search=node("input");search.placeholder="Поиск по делам";search.setAttribute("aria-label","Поиск дел");
 toolbar.append(filter,search);
 const list=node("div","dela-list");list.setAttribute("aria-live","polite");
 const message=node("p","dela-message");message.setAttribute("role","status");
 const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");};
 function draw():void{
  const complete=tasks.filter(x=>x.status==="done").length;
  const overdue=tasks.filter(x=>dueState(x,today())==="overdue").length;
  stats.textContent=tasks.length+" всего · "+complete+" готово · "+overdue+" просрочено";
  const q=search.value.trim().toLocaleLowerCase("ru-RU");
  const visible=tasks.filter(t=>(filter.value==="all"||filter.value===t.status||(filter.value==="overdue"&&dueState(t,today())==="overdue"))&&
   (!q||t.title.toLocaleLowerCase("ru-RU").includes(q)||t.notes.toLocaleLowerCase("ru-RU").includes(q)))
   .sort((a,b)=>Number(a.status==="done")-Number(b.status==="done")||
    Number(b.priority==="high")-Number(a.priority==="high")||b.updatedAt-a.updatedAt);
  list.replaceChildren();
  if(!visible.length){list.append(node("p","dela-empty",tasks.length?"По выбранному фильтру дел нет":"Пока нет дел. Добавьте первое."));return;}
  for(const task of visible){
   const card=node("article","dela-task "+task.status+" "+task.priority);
   const top=node("div","dela-task-head");
   const name=node("strong","",task.title);const badge=node("span","dela-priority",task.priority==="high"?"Высокий":task.priority==="low"?"Низкий":"Обычный");
   top.append(name,badge);
   const description=node("p","",task.notes);description.hidden=!task.notes;
   const bottom=node("div","dela-task-actions");
   const select=node("select");select.setAttribute("aria-label","Статус: "+task.title);
   for(const [value,label] of [["todo","В планах"],["doing","В работе"],["done","Готово"]]){
    const o=node("option","",label);o.value=value;select.append(o);
   }
   select.value=task.status;
   select.addEventListener("change",()=>{task.status=select.value as TaskStatus;task.updatedAt=Date.now();save();draw();});
   const dueLabel=node("span","dela-due",task.due?"До "+task.due:"Без срока");
   dueLabel.dataset.state=dueState(task,today());
   const remove=node("button","dela-remove","Удалить");remove.type="button";
   remove.setAttribute("aria-label","Удалить дело: "+task.title);
   remove.addEventListener("click",()=>{if(!window.confirm("Удалить дело «"+task.title+"»?"))return;tasks=tasks.filter(t=>t.id!==task.id);save();draw();});
   bottom.append(select,dueLabel,remove);card.append(top,description,bottom);list.append(card);
  }
 }
 form.addEventListener("submit",event=>{
  event.preventDefault();
  if(tasks.length>=500){message.textContent="Достигнут лимит 500 дел.";return;}
  const value=title.value.trim();
  if(!value){title.focus();return;}
  const now=Date.now();
  const task:Task={id:crypto.randomUUID(),title:value,notes:notes.value.trim(),status:"todo",priority:priority.value as TaskPriority,due:due.value,createdAt:now,updatedAt:now};
  tasks.unshift(task);
  message.textContent=save()?"Дело добавлено.":"Дело добавлено, но сохранить его в браузере не удалось.";
  form.reset();draw();title.focus();
 });
 filter.addEventListener("change",draw);search.addEventListener("input",draw);
 root.append(head,form,toolbar,message,list);host.append(root);draw();
}
