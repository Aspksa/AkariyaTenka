import { createHealthBadge } from "../components/health-badge.js";
import type { HealthState } from "../state/health.js";
import { createIcon, type IconName } from "../components/icons.js";
import { createNotificationCenter } from "../components/notifications.js";
import { DEFAULT_DASHBOARD, moveDashboardCard, parseDashboardPreferences, toggleDashboardCard, type CardId } from "../state/dashboard-preferences.js";

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
 const toolInfo=[
  {slug:"diagnostics",name:"Диагностика",symbol:"activity" as const,loader:()=>import("../features/diagnostics.js").then(m=>m.mountDiagnostics),caption:"Состояние и измерения системы"},
  {slug:"updates",name:"Обновления GitHub",symbol:"refresh" as const,loader:()=>import("../features/github-updates.js").then(m=>m.mountGithubUpdates),caption:"Проверка новых изменений проекта"}
 ];
 const workspace=el("section","content");
 const overview=el("div","overview");
 const pageTitle=el("h2","page-title","Обзор");
 const notifications=createNotificationCenter(()=>{(tools.children[1] as HTMLButtonElement)?.click();});
 function highlight(active:HTMLButtonElement|null):void {
  pageTitle.textContent=active?.getAttribute("aria-label")??"Обзор";
  for(const other of [topLink,...Array.from(tools.querySelectorAll<HTMLButtonElement>("button"))]){
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
  tools.append(button);panels.append(panel);
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
 mastTitle.append(el("span","breadcrumb","Рабочее пространство"),pageTitle);
 const mastRight=el("div","mast-right");
 mastRight.append(el("span","system-label","v0.1"),notifications.element);
 mast.append(mastBrand,mastTitle,mastRight);

 const intro=el("section","intro");
 intro.append(el("p","section-kicker","Ваша система · под контролем"),el("h1",undefined,"Добро пожаловать в Akariya."),el("p","intro-subtitle","Тихое пространство для управления, безопасности и развития вашей персональной системы."));
 const updateNotice=el("button","update-notice");
 updateNotice.type="button";
 updateNotice.hidden=true;
 updateNotice.setAttribute("aria-label","Открыть доступное обновление Akariya");
 updateNotice.addEventListener("click",()=>{(tools.children[1] as HTMLButtonElement)?.click();});
 async function checkUpdateNotice():Promise<void> {
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
   updateNotice.hidden=data.updateAvailable!==true || deferred;
   if(!updateNotice.hidden) {
    updateNotice.replaceChildren(createIcon("info"),el("span",undefined,"Доступно обновление Akariya"),el("strong",undefined,"Посмотреть"));
    if(typeof data.latest==="string"&&/^[0-9a-f]{40}$/i.test(data.latest))
     notifications.notify({id:"update:"+data.latest,kind:"update",title:"Доступно обновление",
       detail:"Новая версия Akariya "+data.latest.slice(0,12)+" готова к установке."});
   }
  } catch {/* GitHub may be temporarily offline; never interrupt the home page */}
 }
 void checkUpdateNotice();
 window.setInterval(()=>{void checkUpdateNotice();},30*60*1000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void checkUpdateNotice();});
 window.addEventListener("akariya-update-snooze",()=>{void checkUpdateNotice();});
 const status=el("section","status-card");
 const statusCaption=el("div","status-caption");
 const statusIcon=el("span","status-icon");statusIcon.append(createIcon("shield"));statusIcon.setAttribute("aria-hidden","true");
 statusCaption.append(statusIcon,el("div","status-description"));
 const statusDescription=statusCaption.lastElementChild as HTMLElement;
 statusDescription.append(el("span","tiny-label","Состояние ядра"),el("strong",undefined,"Системная готовность"));
 const badge=createHealthBadge();
 const statusFoot=el("div","status-foot");
 statusFoot.append(badge.element,el("p","status-note","Akariya работает локально: данные остаются на этом устройстве."));
 status.append(statusCaption,statusFoot);

 const actionHeader=el("div","section-title");
 actionHeader.append(el("h2",undefined,"Центр управления"));
 const cards=el("div","action-grid");
 const dashboardControls=el("div","dashboard-controls");
 const customize=el("button","dashboard-customize","Настроить главную");
 customize.type="button";customize.append(createIcon("settings"));customize.title="Настроить карточки";
 customize.setAttribute("aria-expanded","false");
 const editor=el("div","dashboard-editor");editor.hidden=true;
 actionHeader.append(customize);
 dashboardControls.append(editor);
 const preferencesKey="akariya-dashboard-v1";
 let preferences={...DEFAULT_DASHBOARD,order:[...DEFAULT_DASHBOARD.order],hidden:[...DEFAULT_DASHBOARD.hidden]};
 try{preferences=parseDashboardPreferences(JSON.parse(localStorage.getItem(preferencesKey)??"null"));}catch{/* Use defaults. */}
 const actions:Record<CardId,{index:string;name:string;detail:string;tool:number}>={
  diagnostics:{index:"01",name:"Диагностика",detail:"Мониторинг системы, показатели производительности и состояние модулей.",tool:0},
  updates:{index:"02",name:"Обновления GitHub",detail:"Проверить последнюю версию Akariya на GitHub.",tool:1}
 };
 function persistPreferences():void {
  try{localStorage.setItem(preferencesKey,JSON.stringify(preferences));}catch{/* Storage may be disabled. */}
 }
 function renderDashboard():void {
  cards.replaceChildren();editor.replaceChildren();
  for(const id of preferences.order){
   const data=actions[id];
   const hidden=preferences.hidden.includes(id);
   if(!hidden){
    const card=el("button","action-card");card.type="button";
    const emblem=el("span","card-icon");
    emblem.append(createIcon(id==="diagnostics"?"activity":"refresh"));
    card.append(el("span","card-index",data.index),emblem,el("strong","card-name",data.name),
      el("span","card-detail",data.detail),el("span","card-arrow"));
    card.lastElementChild?.append(createIcon("arrow-right"));
    card.addEventListener("click",()=>{(tools.children[data.tool] as HTMLButtonElement).click();});
    cards.append(card);
   }
   const line=el("div","dashboard-editor-row");
   const name=el("span",undefined,data.name);
   line.append(name);
   const makeControl=(label:string,glyph:IconName,fn:()=>void,disabled=false)=>{
    const action=el("button","dashboard-editor-button");action.type="button";action.title=label;
    action.setAttribute("aria-label",label+" — "+data.name);action.disabled=disabled;
    action.append(createIcon(glyph));action.addEventListener("click",fn);line.append(action);
   };
   const position=preferences.order.indexOf(id);
   makeControl("Выше","arrow-up",()=>{preferences=moveDashboardCard(preferences,id,-1);persistPreferences();renderDashboard();},position===0);
   makeControl("Ниже","arrow-down",()=>{preferences=moveDashboardCard(preferences,id,1);persistPreferences();renderDashboard();},position===preferences.order.length-1);
   makeControl(hidden?"Показать":"Скрыть",hidden?"eye-off":"eye",()=>{
    preferences=toggleDashboardCard(preferences,id);persistPreferences();renderDashboard();
   });
   editor.append(line);
  }
  if(!cards.childElementCount)cards.append(el("p","dashboard-empty","Все карточки скрыты. Откройте «Настроить главную», чтобы вернуть их."));
 }
 customize.addEventListener("click",()=>{
  editor.hidden=!editor.hidden;
  customize.setAttribute("aria-expanded",String(!editor.hidden));
 });
 renderDashboard();
 const bottom=el("footer","bottom-line");
 bottom.append(el("span",undefined,"Akariya Tenka"),el("span",undefined,"Crimson · private by design"));
 const hero=el("section","hero");
 hero.append(intro,status);
 overview.append(updateNotice,hero,actionHeader,dashboardControls,cards);
 workspace.append(mast,overview,panels,bottom);
 showRoute();
 shell.append(aside,workspace);
 return {element:shell,update:(state)=>{
  badge.update(state);
  if(state.kind==="error")notifications.notify({id:"health:error",kind:"error",title:"Проблема соединения",
   detail:state.message.slice(0,250)});
 }};
}
