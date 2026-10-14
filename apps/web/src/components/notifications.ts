import { createIcon } from "./icons.js";
export type NoticeKind="update"|"error"|"info";
export interface Notice { id:string;kind:NoticeKind;title:string;detail:string;at:number;read:boolean;archived?:boolean }
const KEY="akariya-notifications-v1";
const SETTINGS_KEY="akariya-notification-settings-v1";
export interface NoticeSettings {showUpdates:boolean;showErrors:boolean;showInfo:boolean;unreadOnly:boolean;sound:boolean;doNotDisturb:boolean;minimumPriority:"all"|"important"|"critical";retentionDays:7|30|90|0;density:"compact"|"expanded";opacity:70|85|100;fontScale:90|100|115}
const defaults:NoticeSettings={showUpdates:true,showErrors:true,showInfo:true,unreadOnly:false,sound:false,doNotDisturb:false,minimumPriority:"all",retentionDays:30,density:"expanded",opacity:100,fontScale:100};
export function parseNoticeSettings(input:unknown):NoticeSettings {
 if(!input||typeof input!=="object"||Array.isArray(input))return {...defaults};
 const v=input as Record<string,unknown>;
 return {
  showUpdates:typeof v.showUpdates==="boolean"?v.showUpdates:true,
  showErrors:typeof v.showErrors==="boolean"?v.showErrors:true,
  showInfo:typeof v.showInfo==="boolean"?v.showInfo:true,
  unreadOnly:typeof v.unreadOnly==="boolean"?v.unreadOnly:false,
  sound:typeof v.sound==="boolean"?v.sound:false,
  doNotDisturb:typeof v.doNotDisturb==="boolean"?v.doNotDisturb:false,
  minimumPriority:v.minimumPriority==="important"||v.minimumPriority==="critical"?v.minimumPriority:"all",
  retentionDays:v.retentionDays===7||v.retentionDays===90||v.retentionDays===0?v.retentionDays:30,
  density:v.density==="compact"?"compact":"expanded",
  opacity:v.opacity===70||v.opacity===85?v.opacity:100,
  fontScale:v.fontScale===90||v.fontScale===115?v.fontScale:100
 };
}

export function parseNotices(value:unknown):Notice[] {
 if(!Array.isArray(value)) return [];
 const entries=value.filter((x):x is Notice=>!!x&&typeof x==="object"&&
  typeof x.id==="string"&&/^[a-z0-9:-]{1,100}$/.test(x.id)&&
  ["update","error","info"].includes(x.kind)&&
  typeof x.title==="string"&&x.title.length<=120&&
  typeof x.detail==="string"&&x.detail.length<=300&&
  typeof x.at==="number"&&Number.isFinite(x.at)&&typeof x.read==="boolean"&&(x.archived===undefined||typeof x.archived==="boolean"));
 const unique=new Map<string,Notice>();
 for(const item of entries)unique.set(item.id,item);
 return [...unique.values()].slice(-30);
}
export function createNotificationCenter(openUpdates:()=>void){
 const wrapper=document.createElement("div");wrapper.className="notification-center";
 const toggle=document.createElement("button");toggle.type="button";toggle.className="notification-toggle";
 toggle.append(createIcon("bell"));toggle.setAttribute("aria-label","Уведомления");
 toggle.setAttribute("aria-expanded","false");toggle.title="Уведомления";
 const dot=document.createElement("span");dot.className="notification-severity-dot";dot.hidden=true;dot.setAttribute("aria-hidden","true");toggle.append(dot);
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
 const addSetting=(key:"showUpdates"|"showErrors"|"showInfo"|"unreadOnly"|"sound"|"doNotDisturb",label:string):void=>{
  const row=document.createElement("label");row.className="notification-setting";
  const input=document.createElement("input");input.type="checkbox";input.checked=settings[key];
  input.addEventListener("change",()=>{
   settings={...settings,[key]:input.checked};
   if(key==="sound"&&input.checked){try{audio??=new AudioContext();void audio.resume().catch(()=>{});}catch{/* unsupported */}}
   try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{/* storage unavailable */}
   prune();draw();
  });
  const name=document.createElement("span");name.textContent=label;
  row.append(input,name);settingsPanel.append(row);
 };
 addSetting("showUpdates","Показывать обновления");
 addSetting("showErrors","Показывать ошибки");
 addSetting("showInfo","Показывать информационные");
 addSetting("unreadOnly","Только непрочитанные");
 addSetting("sound","Звук новых уведомлений");
 addSetting("doNotDisturb","Не беспокоить — отключить звуки");
 const choice=(label:string,options:readonly {value:string;title:string}[],current:string,change:(value:string)=>void):void=>{
  const row=document.createElement("label");row.className="notification-setting";
  const caption=document.createElement("span");caption.textContent=label;
  const select=document.createElement("select");select.setAttribute("aria-label",label);
  for(const option of options){const node=document.createElement("option");node.value=option.value;node.textContent=option.title;select.append(node);}
  select.value=current;select.addEventListener("change",()=>change(select.value));
  row.append(caption,select);settingsPanel.append(row);
 };
 const persistSettings=():void=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{/* restricted */}};
 choice("Приоритет",[
  {value:"all",title:"Все уведомления"},{value:"important",title:"Важные и критические"},
  {value:"critical",title:"Только критические"}],settings.minimumPriority,value=>{
   if(value!=="all"&&value!=="important"&&value!=="critical")return;
   settings={...settings,minimumPriority:value};persistSettings();draw();
 });
 choice("Срок хранения",[
  {value:"7",title:"7 дней"},{value:"30",title:"30 дней"},
  {value:"90",title:"90 дней"},{value:"0",title:"Без ограничения по времени"}],
  String(settings.retentionDays),value=>{
   const days=Number(value);if(days!==0&&days!==7&&days!==30&&days!==90)return;
   settings={...settings,retentionDays:days};persistSettings();prune();draw();
 });

 const hint=document.createElement("p");hint.className="notification-empty";
 hint.textContent="Фильтры скрывают записи в списке, но не удаляют события.";
 settingsPanel.append(hint);wrapper.append(settingsPanel);

 try{notices=parseNotices(JSON.parse(localStorage.getItem(KEY)??"[]"));}catch{/* storage unavailable */}
 function save(){try{localStorage.setItem(KEY,JSON.stringify(notices));}catch{/* no persistent storage */}}
 function prune():void{
  if(settings.retentionDays===0)return;
  const cutoff=Date.now()-settings.retentionDays*86400000;
  const kept=notices.filter(n=>n.at>=cutoff);
  if(kept.length!==notices.length){notices=kept;save();}
 }
 let audio:AudioContext|null=null;
 function sound():void{
  if(!settings.sound||settings.doNotDisturb||document.visibilityState!=="visible")return;
  try{
   audio??=new AudioContext();
   if(audio.state!=="running")return;
   const osc=audio.createOscillator(),gain=audio.createGain();
   osc.type="sine";osc.frequency.value=660;
   gain.gain.setValueAtTime(0.025,audio.currentTime);
   gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+0.13);
   osc.connect(gain);gain.connect(audio.destination);
   osc.start();osc.stop(audio.currentTime+0.13);
  }catch{/* Audio may be blocked */}
 }
 function draw(){
  const unread=notices.filter(x=>!x.read).length;count.hidden=unread===0;count.textContent=String(unread);
  toggle.setAttribute("aria-label",unread?"Уведомления, непрочитанных: "+unread:"Уведомления");
  items.replaceChildren();
  const visible=notices.filter(n=>(!settings.unreadOnly||!n.read)&&
   (settings.minimumPriority==="all"||n.kind==="error"||(settings.minimumPriority==="important"&&n.kind==="update"))&&
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
 prune();draw();
 return {
  element:wrapper,
  notify(item:Omit<Notice,"read"|"at">&{at?:number}){
   const old=notices.find(n=>n.id===item.id);
   if(old && old.title===item.title && old.detail===item.detail)return;
   notices=[...notices.filter(n=>n.id!==item.id),{...item,at:item.at??Date.now(),read:false}].slice(-30);
   prune();save();draw();
   if(!old)sound();
  },
  dismiss(prefix:string){
   const previous=notices.length;
   notices=notices.filter(n=>!n.id.startsWith(prefix));
   if(previous!==notices.length){save();draw();}
  }
 };
}
