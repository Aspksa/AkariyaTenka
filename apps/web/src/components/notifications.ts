import { createIcon } from "./icons.js";
export type NoticeKind="update"|"error"|"info";
export interface Notice { id:string;kind:NoticeKind;title:string;detail:string;at:number;read:boolean }
const KEY="akariya-notifications-v1";
const SETTINGS_KEY="akariya-notification-settings-v1";
export interface NoticeSettings {showUpdates:boolean;showErrors:boolean;showInfo:boolean;unreadOnly:boolean}
const defaults:NoticeSettings={showUpdates:true,showErrors:true,showInfo:true,unreadOnly:false};
export function parseNoticeSettings(input:unknown):NoticeSettings {
 if(!input||typeof input!=="object"||Array.isArray(input))return {...defaults};
 const v=input as Record<string,unknown>;
 return {
  showUpdates:typeof v.showUpdates==="boolean"?v.showUpdates:true,
  showErrors:typeof v.showErrors==="boolean"?v.showErrors:true,
  showInfo:typeof v.showInfo==="boolean"?v.showInfo:true,
  unreadOnly:typeof v.unreadOnly==="boolean"?v.unreadOnly:false
 };
}

export function parseNotices(value:unknown):Notice[] {
 if(!Array.isArray(value)) return [];
 const entries=value.filter((x):x is Notice=>!!x&&typeof x==="object"&&
  typeof x.id==="string"&&/^[a-z0-9:-]{1,100}$/.test(x.id)&&
  ["update","error","info"].includes(x.kind)&&
  typeof x.title==="string"&&x.title.length<=120&&
  typeof x.detail==="string"&&x.detail.length<=300&&
  typeof x.at==="number"&&Number.isFinite(x.at)&&typeof x.read==="boolean");
 const unique=new Map<string,Notice>();
 for(const item of entries)unique.set(item.id,item);
 return [...unique.values()].slice(-30);
}
export function createNotificationCenter(openUpdates:()=>void){
 const wrapper=document.createElement("div");wrapper.className="notification-center";
 const toggle=document.createElement("button");toggle.type="button";toggle.className="notification-toggle";
 toggle.append(createIcon("bell"));toggle.setAttribute("aria-label","Уведомления");
 toggle.setAttribute("aria-expanded","false");toggle.title="Уведомления";
 const count=document.createElement("span");count.className="notification-count";count.hidden=true;toggle.append(count);
 const panel=document.createElement("section");panel.className="notification-panel";panel.hidden=true;
 panel.setAttribute("aria-label","Центр уведомлений");
 const heading=document.createElement("div");heading.className="notification-heading";
 const title=document.createElement("strong");title.textContent="Уведомления";
 const clear=document.createElement("button");clear.type="button";clear.textContent="Очистить";clear.className="notification-clear";
 heading.append(title,clear);
 const items=document.createElement("div");items.className="notification-items";panel.append(heading,items);wrapper.append(toggle,panel);
 let notices:Notice[]=[];
 let settings={...defaults};
 try{settings=parseNoticeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)??"null"));}catch{/* storage unavailable */}
 const settingsPanel=document.createElement("section");
 settingsPanel.className="notification-panel notification-settings";
 settingsPanel.hidden=true;settingsPanel.setAttribute("aria-label","Настройки уведомлений");
 const settingsTitle=document.createElement("strong");settingsTitle.textContent="Настройки уведомлений";settingsPanel.append(settingsTitle);
 const addSetting=(key:keyof NoticeSettings,label:string):void=>{
  const row=document.createElement("label");row.className="notification-setting";
  const input=document.createElement("input");input.type="checkbox";input.checked=settings[key];
  input.addEventListener("change",()=>{
   settings={...settings,[key]:input.checked};
   try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{/* storage unavailable */}
   draw();
  });
  const name=document.createElement("span");name.textContent=label;
  row.append(input,name);settingsPanel.append(row);
 };
 addSetting("showUpdates","Показывать обновления");
 addSetting("showErrors","Показывать ошибки");
 addSetting("showInfo","Показывать информационные");
 addSetting("unreadOnly","Только непрочитанные");
 const hint=document.createElement("p");hint.className="notification-empty";
 hint.textContent="Фильтры скрывают записи в списке, но не удаляют события.";
 settingsPanel.append(hint);wrapper.append(settingsPanel);

 try{notices=parseNotices(JSON.parse(localStorage.getItem(KEY)??"[]"));}catch{/* storage unavailable */}
 function save(){try{localStorage.setItem(KEY,JSON.stringify(notices));}catch{/* no persistent storage */}}
 function draw(){
  const unread=notices.filter(x=>!x.read).length;count.hidden=unread===0;count.textContent=String(unread);
  toggle.setAttribute("aria-label",unread?"Уведомления, непрочитанных: "+unread:"Уведомления");
  items.replaceChildren();
  const visible=notices.filter(n=>(!settings.unreadOnly||!n.read)&&
   (n.kind==="update"?settings.showUpdates:n.kind==="error"?settings.showErrors:settings.showInfo));
  for(const item of [...visible].reverse()){
   const row=document.createElement("article");row.className="notification-item"+(item.read?"":" unread");
   const header=document.createElement("strong");header.textContent=item.title;
   const text=document.createElement("p");text.textContent=item.detail;
   const time=document.createElement("time");time.dateTime=new Date(item.at).toISOString();time.textContent=new Date(item.at).toLocaleString("ru-RU");
   row.append(header,text,time);
   if(item.kind==="update"){
    const show=document.createElement("button");show.type="button";show.textContent="Открыть обновления";
    show.addEventListener("click",()=>{close();openUpdates();});row.append(show);
   }
   items.append(row);
  }
  if(!visible.length){const empty=document.createElement("p");empty.className="notification-empty";empty.textContent="Пока нет уведомлений";items.append(empty);}
 }
 function close(){panel.hidden=true;settingsPanel.hidden=true;toggle.setAttribute("aria-expanded","false");}
 toggle.addEventListener("click",()=>{
  const opening=panel.hidden;close();panel.hidden=!opening;toggle.setAttribute("aria-expanded",String(opening));
  if(opening){notices=notices.map(n=>({...n,read:true}));save();draw();}
 });
 toggle.addEventListener("contextmenu",event=>{
  event.preventDefault();const opening=settingsPanel.hidden;close();
  settingsPanel.hidden=!opening;toggle.setAttribute("aria-expanded",String(opening));
 });
 clear.addEventListener("click",()=>{notices=[];save();draw();});
 wrapper.addEventListener("keydown",event=>{if(event.key==="Escape"){close();toggle.focus();}});
 document.addEventListener("pointerdown",event=>{if(!wrapper.contains(event.target as Node))close();});
 draw();
 return {
  element:wrapper,
  notify(item:Omit<Notice,"read"|"at">&{at?:number}){
   const old=notices.find(n=>n.id===item.id);
   if(old && old.title===item.title && old.detail===item.detail)return;
   notices=[...notices.filter(n=>n.id!==item.id),{...item,at:item.at??Date.now(),read:false}].slice(-30);
   save();draw();
  },
  dismiss(prefix:string){
   const previous=notices.length;
   notices=notices.filter(n=>!n.id.startsWith(prefix));
   if(previous!==notices.length){save();draw();}
  }
 };
}
