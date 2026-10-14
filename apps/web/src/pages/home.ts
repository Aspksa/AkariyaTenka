import { createHealthBadge } from "../components/health-badge.js";
import type { HealthState } from "../state/health.js";

export interface HomeView { readonly element: HTMLElement; update(state: HealthState): void; }
function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string):HTMLElementTagNameMap[K] {
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=text;
 return node;
}
function icon(name:string):HTMLElement {
 const symbol=el("span","nav-symbol",name);
 symbol.setAttribute("aria-hidden","true");
 return symbol;
}
export function createHomeView():HomeView {
 const shell=el("main","workspace");
 const aside=el("aside","sidebar");
 const branding=el("div","branding");
 const mark=el("img","brand-mark") as HTMLImageElement;
 mark.src="/akariya-fox.svg";mark.alt="Akariya Tenka";mark.width=46;mark.height=46;
 const brandText=el("div","brand-text");
 brandText.append(el("strong",undefined,"AKARIYA"),el("span",undefined,"TENKA · PRIVATE SYSTEM"));
 branding.append(mark,brandText);
 const nav=el("nav","navigation");nav.setAttribute("aria-label","Разделы");
 const sectionTitle=el("p","nav-heading","ПРОСТРАНСТВО");
 const topLink=el("button","nav-item active");
 topLink.type="button";topLink.append(icon("⌂"),el("span",undefined,"Обзор"));
 topLink.setAttribute("aria-current","page");
 const sectionLabel=el("p","nav-heading secondary-heading","УПРАВЛЕНИЕ");
 const tools=el("div","nav-tools");
 const panels=el("section","tool-panels");
 panels.setAttribute("aria-label","Панель управления");
 const toolInfo=[
  {name:"Диагностика",symbol:"◇",loader:()=>import("../features/diagnostics.js").then(m=>m.mountDiagnostics),caption:"Состояние и измерения системы"}
 ];
 const workspace=el("section","content");
 for(const info of toolInfo){
  const button=el("button","nav-item");button.type="button";
  button.append(icon(info.symbol),el("span",undefined,info.name));
  button.setAttribute("aria-expanded","false");
  const panel=el("section","tool-panel");
  panel.hidden=true;
  panel.setAttribute("aria-label",info.name);
  const panelHeader=el("div","panel-head");
  panelHeader.append(el("div",undefined,info.name),el("p",undefined,info.caption));
  const area=el("div","panel-body");
  panel.append(panelHeader,area);
  let loaded=false;
  button.addEventListener("click",()=>{
   const opening=panel.hidden;
   for(const other of tools.querySelectorAll("button")){other.classList.remove("active");other.setAttribute("aria-expanded","false");}
   for(const other of panels.children){(other as HTMLElement).hidden=true;}
   panel.hidden=!opening;
   if(!opening)return;
   button.classList.add("active");button.setAttribute("aria-expanded","true");
   panel.scrollIntoView({behavior:"smooth",block:"nearest"});
   if(loaded)return;
   loaded=true;area.textContent="Загрузка раздела…";
   void info.loader().then(mount=>mount(area)).catch((error:unknown)=>{
    loaded=false;area.textContent=error instanceof Error?error.message:String(error);
   });
  });
  tools.append(button);panels.append(panel);
 }
 nav.append(sectionTitle,topLink,sectionLabel,tools);
 topLink.addEventListener("click",()=>{
  for(const other of tools.querySelectorAll("button")){other.classList.remove("active");other.setAttribute("aria-expanded","false");}
  for(const panel of panels.children)(panel as HTMLElement).hidden=true;
  window.scrollTo({top:0,behavior:"smooth"});
 });
 const sidebarFoot=el("div","sidebar-foot");
 sidebarFoot.append(el("span","online-dot"),el("span",undefined,"ЛОКАЛЬНАЯ СИСТЕМА"));
 aside.append(branding,nav,sidebarFoot);

 const mast=el("header","masthead");
 const crumb=el("span","breadcrumb","РАБОЧЕЕ ПРОСТРАНСТВО  /  ОБЗОР");
 const mastRight=el("div","mast-right");
 mastRight.append(el("span","system-label","AKARIYA  ·  v0.1"));
 mast.append(crumb,mastRight);

 const intro=el("section","intro");
 intro.append(el("p","section-kicker","ВАША СИСТЕМА · ПОД КОНТРОЛЕМ"),el("h1",undefined,"Добро пожаловать в Akariya."),el("p","intro-subtitle","Тихое пространство для управления, безопасности и развития вашей персональной системы."));
 const status=el("section","status-card");
 const statusCaption=el("div","status-caption");
 statusCaption.append(el("span","status-icon","✦"),el("div","status-description"));
 const statusDescription=statusCaption.lastElementChild as HTMLElement;
 statusDescription.append(el("span","tiny-label","СОСТОЯНИЕ ЯДРА"),el("strong",undefined,"Системная готовность"));
 const badge=createHealthBadge();
 status.append(statusCaption,badge.element);

 const actionHeader=el("div","section-title");
 actionHeader.append(el("h2",undefined,"Центр управления"),el("span",undefined,"БЫСТРЫЙ ДОСТУП"));
 const cards=el("div","action-grid");
 const actions=[
  {index:"01",name:"Диагностика",detail:"Мониторинг системы, показатели производительности и состояние модулей."}
 ];
 actions.forEach((data,index)=>{
  const card=el("button","action-card");
  card.type="button";
  card.append(el("span","card-index",data.index),el("strong","card-name",data.name),el("span","card-detail",data.detail),el("span","card-arrow","↗"));
  card.addEventListener("click",()=>{const button=tools.children[index] as HTMLButtonElement;button.click();});
  cards.append(card);
 });
 const bottom=el("div","bottom-line");
 bottom.append(el("span",undefined,"AKARIYA TENKA"),el("span",undefined,"CRIMSON · PRIVATE BY DESIGN"));
 workspace.append(mast,intro,status,actionHeader,cards,panels,bottom);
 shell.append(aside,workspace);
 return {element:shell,update:(state)=>badge.update(state)};
}
