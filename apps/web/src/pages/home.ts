import type { HealthState } from "../state/health.js";
import { createIcon, type IconName } from "../components/icons.js";
import { createNotificationCenter } from "../components/notifications.js";

export interface HomeView { readonly element: HTMLElement; update(state: HealthState): void; }
function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string):HTMLElementTagNameMap[K] {
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=text;
 return node;
}
function icon(name:IconName):HTMLElement {
 const symbol=el("span","nav-symbol");
 symbol.append(createIcon(name));
 symbol.setAttribute("aria-hidden","true");
 return symbol;
}
export function createHomeView():HomeView {
 const shell=el("main","workspace");
 const aside=el("aside","sidebar");
 const collapseKey="akariya-sidebar-collapsed";
 const collapseButton=el("button","nav-item sidebar-toggle");
 collapseButton.type="button";
 collapseButton.setAttribute("aria-controls","akariya-sidebar-navigation");
 function setCollapsed(collapsed:boolean):void {
  shell.classList.toggle("sidebar-collapsed",collapsed);
  collapseButton.setAttribute("aria-expanded",String(!collapsed));
  collapseButton.setAttribute("aria-label",collapsed?"Развернуть боковое меню":"Свернуть боковое меню");
  collapseButton.title=collapsed?"Развернуть меню":"Свернуть меню";
  collapseButton.replaceChildren(icon(collapsed?"chevron-right":"chevron-left"),el("span",undefined,"Свернуть меню"));
 }
 let savedCollapsed=false;
 try{savedCollapsed=window.localStorage.getItem(collapseKey)==="true";}catch{/* Storage can be disabled. */}
 setCollapsed(savedCollapsed);
 collapseButton.addEventListener("click",()=>{
  const collapsed=!shell.classList.contains("sidebar-collapsed");
  setCollapsed(collapsed);
  try{window.localStorage.setItem(collapseKey,String(collapsed));}catch{/* Still allow temporary toggle. */}
 });
 const branding=el("div","branding");
 const mark=el("img","brand-mark") as HTMLImageElement;
 mark.src="/akariya-fox.svg";mark.alt="Akariya Tenka";mark.width=46;mark.height=46;
 const brandText=el("div","brand-text");
 brandText.append(el("strong",undefined,"AKARIYA"),el("span",undefined,"TENKA · PRIVATE SYSTEM"));
 branding.append(mark,brandText);
 const nav=el("nav","navigation");nav.id="akariya-sidebar-navigation";nav.setAttribute("aria-label","Разделы");
 const sectionTitle=el("p","nav-heading","ПРОСТРАНСТВО");
 const topLink=el("button","nav-item active");
 topLink.type="button";topLink.append(icon("home"),el("span",undefined,"Обзор"));
 topLink.setAttribute("aria-current","page");
 topLink.title="Обзор";topLink.setAttribute("aria-label","Обзор");
 const sectionLabel=el("p","nav-heading secondary-heading","УПРАВЛЕНИЕ");
 const tools=el("div","nav-tools");
 const panels=el("section","tool-panels");
 panels.setAttribute("aria-label","Панель управления");
 const pages:{slug:string;button:HTMLButtonElement;panel:HTMLElement;load:()=>void}[]=[];
 let updateTopButton:HTMLButtonElement|null=null;
 const toolInfo=[
  {slug:"dela",name:"Дела",symbol:"check" as const,loader:()=>import("../features/dela.js").then(m=>m.mountDela),caption:"Планы, задачи и сроки"},
  {slug:"diagnostics",name:"Диагностика",symbol:"activity" as const,loader:()=>import("../features/diagnostics.js").then(m=>m.mountDiagnostics),caption:"Состояние и измерения системы"},
  {slug:"updates",name:"Обновления GitHub",symbol:"refresh" as const,loader:()=>import("../features/github-updates.js").then(m=>m.mountGithubUpdates),caption:"Проверка новых изменений проекта"}
 ];
 const workspace=el("section","content");
 const overview=el("div","overview");
 const pageTitle=el("h2","page-title");
 const notifications=createNotificationCenter(()=>{navigate("updates");});
 window.addEventListener("akariya-update-notice",(event:Event)=>{
  const data=(event as CustomEvent<unknown>).detail;
  if(!data||typeof data!=="object")return;
  const n=data as {id?:unknown;kind?:unknown;title?:unknown;detail?:unknown};
  if(typeof n.id!=="string"|| !/^[a-z0-9:-]{1,100}$/.test(n.id) ||
    !["update","error","info"].includes(String(n.kind)) ||
    typeof n.title!=="string"||n.title.length>120 ||
    typeof n.detail!=="string"||n.detail.length>300)return;
  if(n.id.startsWith("update:state:"))notifications.dismiss("update:"+n.id.slice("update:state:".length));
  notifications.notify({id:n.id,kind:n.kind as "update"|"error"|"info",
    title:n.title,detail:n.detail});
 });
 function highlight(active:HTMLButtonElement|null):void {
  // The overview has no heading; section pages show their name in the top bar.
  pageTitle.textContent=active===topLink?"":active?.getAttribute("aria-label")??"";
  for(const other of [topLink,...Array.from(tools.querySelectorAll<HTMLButtonElement>("button")), ...(updateTopButton?[updateTopButton]:[])]){
   other.classList.toggle("active",other===active);
   if(other===active)other.setAttribute("aria-current","page");
   else other.removeAttribute("aria-current");
  }
 }
 for(const info of toolInfo){
  const button=el("button","nav-item");button.type="button";
  button.append(icon(info.symbol),el("span",undefined,info.name));
  button.setAttribute("aria-label",info.name);button.title=info.name;
  const panel=el("section","tool-panel");
  panel.hidden=true;
  panel.setAttribute("aria-label",info.name);
  const panelHeader=el("div","panel-head");
  const panelIcon=el("span","panel-icon");panelIcon.append(createIcon(info.symbol));panelIcon.setAttribute("aria-hidden","true");
  panelHeader.append(panelIcon);
  const panelTitle=el("div","panel-title");
  panelTitle.append(el("div",undefined,info.name),el("p",undefined,info.caption));
  const closePanel=el("button","panel-close");closePanel.type="button";
  closePanel.title="Вернуться к обзору";closePanel.setAttribute("aria-label","Закрыть раздел «"+info.name+"» и вернуться к обзору");
  closePanel.append(createIcon("close"));
  closePanel.addEventListener("click",()=>{topLink.click();topLink.focus();});
  panelHeader.append(panelTitle,closePanel);
  const area=el("div","panel-body");
  panel.append(panelHeader,area);
  let loaded=false;
  pages.push({slug:info.slug,button,panel,load:()=>{
   if(loaded)return;
   loaded=true;area.textContent="Загрузка раздела…";
   void info.loader().then(mount=>{area.replaceChildren();return mount(area);}).catch((error:unknown)=>{
    loaded=false;area.textContent=error instanceof Error?error.message:String(error);
   });
  }});
  button.addEventListener("click",()=>{navigate(info.slug);});
  if(info.slug==="updates")updateTopButton=button;
  else tools.append(button);
  panels.append(panel);
 }
 nav.append(sectionTitle,topLink,sectionLabel,tools);
 topLink.addEventListener("click",()=>{navigate("");});
 // Each menu entry is its own page, addressed by the URL hash so Back/Forward work.
 function navigate(slug:string):void {
  const target="#/"+slug;
  if(window.location.hash===target||(!slug&&!window.location.hash))showRoute();
  else window.location.hash=target;
 }
 function showRoute():void {
  const slug=window.location.hash.replace(/^#\/?/,"");
  const page=pages.find(item=>item.slug===slug);
  overview.hidden=!!page;
  for(const item of pages)item.panel.hidden=item!==page;
  highlight(page?.button??topLink);
  page?.load();
  window.scrollTo({top:0});
 }
 window.addEventListener("hashchange",showRoute);
 const sidebarFoot=el("div","sidebar-foot");
 const systemState=el("div","system-state");
 systemState.title="Локальная система";
 systemState.append(el("span","online-dot"),el("span",undefined,"ЛОКАЛЬНАЯ СИСТЕМА"));
 sidebarFoot.append(collapseButton,systemState);
 const sidebarInner=el("div","sidebar-inner");
 sidebarInner.append(branding,nav,sidebarFoot);
 aside.append(sidebarInner);

 const mast=el("header","masthead");
 const mastBrand=el("img","mast-brand") as HTMLImageElement;
 mastBrand.src="/akariya-fox.svg";mastBrand.alt="";mastBrand.width=34;mastBrand.height=34;
 const mastTitle=el("div","mast-title");
 mastTitle.append(pageTitle);
 const mastRight=el("div","mast-right");
 if(updateTopButton){
  updateTopButton.className="notification-toggle updates-topbar-toggle";
  updateTopButton.replaceChildren(createIcon("refresh"));
  updateTopButton.setAttribute("aria-label","Обновления GitHub");
  updateTopButton.title="Обновления GitHub";
  mastRight.append(updateTopButton);
 }
 mastRight.append(notifications.element);
 mast.append(mastBrand,mastTitle,mastRight);

 // Only the global bell owns notification state. Recover update results after a page reload.
 async function reconcileUpdateOutcome():Promise<void>{
  const key="akariya-pending-update-v1";
  let pending:{sha:string;startedAt:number;operation:"install"|"rollback"}|null=null;
  try{
   const value=JSON.parse(localStorage.getItem(key)??"null") as unknown;
   if(value&&typeof value==="object"){
    const v=value as {sha?:unknown;startedAt?:unknown;operation?:unknown};
    if(typeof v.sha==="string" && /^[a-f0-9]{40}$/i.test(v.sha) &&
      typeof v.startedAt==="number" && Number.isFinite(v.startedAt) &&
      (v.operation==="install"||v.operation==="rollback"))
     pending={sha:v.sha.toLowerCase(),startedAt:v.startedAt,operation:v.operation};
   }
  }catch{return;}
  if(!pending)return;
  const target=pending;
  if(Date.now()-target.startedAt>24*60*60*1000||target.startedAt>Date.now()+60_000){
   try{localStorage.removeItem(key);}catch{/* No storage */}return;
  }
  try{
   const res=await fetch("/api/updates/history",{cache:"no-store",signal:AbortSignal.timeout(5000)});
   if(!res.ok)return;
   const data=await res.json() as {events?:{at:string;event:string;revision:string|null}[]};
   const eligible=(Array.isArray(data.events)?data.events:[]).filter(e=>
    e && e.revision===target.sha && typeof e.at==="string" &&
    Number.isFinite(Date.parse(e.at)) && Date.parse(e.at)>=target.startedAt-2000 &&
    ["confirmed","rolled_back","failed"].includes(e.event)
   ).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
   const result=eligible[0]?.event;
   if(!result)return;
   if(result==="confirmed"){
    notifications.dismiss("update:"+pending.sha);
    notifications.notify({id:"update:state:"+pending.sha,kind:"info",
      title:"Обновление завершено",detail:"Версия "+pending.sha.slice(0,12)+" успешно установлена."});
   }else{
    notifications.notify({id:"update:state:"+pending.sha,kind:"error",
      title:result==="rolled_back"?"Предыдущая версия восстановлена":"Ошибка обновления",
      detail:"Операция завершилась без установки версии "+pending.sha.slice(0,12)+"."});
   }
   try{localStorage.removeItem(key);}catch{/* No storage */}
  }catch{/* Backend may still be restarting */}
 }
 void reconcileUpdateOutcome();
 window.setInterval(()=>{if(document.visibilityState==="visible")void reconcileUpdateOutcome();},15000);

 // Deadline reminders stay active across every section, not just the Дела page.
 async function checkTaskDeadlines():Promise<void>{
  if(document.visibilityState!=="visible")return;
  try{
   const now=new Date();
   const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
   const r=await fetch("/api/dela/due?today="+today,{cache:"no-store",signal:AbortSignal.timeout(5000)});
   if(!r.ok)return;
   const body=await r.json() as {events?:{id:string;kind:"info"|"error";title:string;detail:string}[]};
   for(const event of Array.isArray(body.events)?body.events:[]){
    if(!event||typeof event.id!=="string"||!/^dela:[a-zA-Z0-9-]+:[0-9-]+$/.test(event.id))continue;
    notifications.notify(event);
   }
  }catch{/* Never block the UI if tasks are temporarily unavailable */}
 }
 void checkTaskDeadlines();
 window.setInterval(()=>{void checkTaskDeadlines();},60_000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void checkTaskDeadlines();});
 // Watch for updates in the background and surface them through the notification bell.
 async function checkForUpdates():Promise<void> {
  if(document.visibilityState!=="visible")return;
  try {
   const response=await fetch("/api/updates/github",{cache:"no-store",signal:AbortSignal.timeout(8000)});
   if(!response.ok)return;
   const data=await response.json() as {latest?:string;updateAvailable?:boolean};
   let deferred=false;
   try {
    const item=JSON.parse(localStorage.getItem("akariya-update-snooze")??"null") as {sha?:string;until?:number}|null;
    deferred=item?.sha===data.latest && typeof item?.until==="number" && item.until>Date.now();
   } catch {/* no saved preference */}
   if(data.updateAvailable===true&&!deferred&&typeof data.latest==="string"&&/^[0-9a-f]{40}$/i.test(data.latest))
    notifications.notify({id:"update:"+data.latest,kind:"update",title:"Доступно обновление",
      detail:"Новая версия Akariya "+data.latest.slice(0,12)+" готова к установке."});
   if(data.updateAvailable===false&&typeof data.latest==="string"&&/^[0-9a-f]{40}$/i.test(data.latest))
    notifications.dismiss("update:"+data.latest);
  } catch {/* GitHub may be temporarily offline; never interrupt the page */}
 }
 void checkForUpdates();
 window.setInterval(()=>{void checkForUpdates();},30*60*1000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void checkForUpdates();});
 window.addEventListener("akariya-update-snooze",()=>{void checkForUpdates();});
 // The overview is intentionally empty for now.
 workspace.append(mast,overview,panels);
 showRoute();
 shell.append(aside,workspace);
 return {element:shell,update:(state)=>{
  if(state.kind==="error")notifications.notify({id:"health:error",kind:"error",title:"Проблема соединения",
   detail:state.message.slice(0,250)});
 }};
}
