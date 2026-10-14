import { createIcon } from "./icons.js";
export type NoticeKind="update"|"error"|"info";
export interface Notice { id:string;kind:NoticeKind;title:string;detail:string;at:number;read:boolean }
const KEY="akariya-notifications-v1";
export function parseNotices(value:unknown):Notice[] {
 if(!Array.isArray(value)) return [];
 return value.filter((x):x is Notice=>!!x&&typeof x==="object"&&
  typeof x.id==="string"&&/^[a-z0-9:-]{1,100}$/.test(x.id)&&
  ["update","error","info"].includes(x.kind)&&
  typeof x.title==="string"&&x.title.length<=120&&
  typeof x.detail==="string"&&x.detail.length<=300&&
  typeof x.at==="number"&&Number.isFinite(x.at)&&typeof x.read==="boolean").slice(-30);
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
 try{notices=parseNotices(JSON.parse(localStorage.getItem(KEY)??"[]"));}catch{/* storage unavailable */}
 function save(){try{localStorage.setItem(KEY,JSON.stringify(notices));}catch{/* no persistent storage */}}
 function draw(){
  const unread=notices.filter(x=>!x.read).length;count.hidden=unread===0;count.textContent=String(unread);
  toggle.setAttribute("aria-label",unread?"Уведомления, непрочитанных: "+unread:"Уведомления");
  items.replaceChildren();
  for(const item of [...notices].reverse()){
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
  if(!notices.length){const empty=document.createElement("p");empty.className="notification-empty";empty.textContent="Пока нет уведомлений";items.append(empty);}
 }
 function close(){panel.hidden=true;toggle.setAttribute("aria-expanded","false");}
 toggle.addEventListener("click",()=>{
  const opening=panel.hidden;panel.hidden=!opening;toggle.setAttribute("aria-expanded",String(opening));
  if(opening){notices=notices.map(n=>({...n,read:true}));save();draw();}
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
  }
 };
}
