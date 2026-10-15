import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@akariya/core";

export interface DelaTask {
 id:string;title:string;notes:string;status:"todo"|"doing"|"done";priority:"low"|"normal"|"high";
 due:string;repeat:"none"|"daily"|"weekly"|"monthly";subtasks:{id:string;text:string;done:boolean}[];
 createdAt:number;updatedAt:number;remindedFor?:string;
}
const validDate=(s:string)=>s===""||(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z")));
export function parseDela(raw:unknown):DelaTask[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,500).filter((item):item is DelaTask=>{
  if(!item||typeof item!=="object")return false;
  const x=item as Partial<DelaTask>;
  return typeof x.id==="string"&&/^[a-zA-Z0-9-]{1,80}$/.test(x.id)&&
   typeof x.title==="string"&&x.title.trim().length>0&&x.title.length<=160&&
   typeof x.notes==="string"&&x.notes.length<=2000&&
   ["todo","doing","done"].includes(x.status??"")&&
   ["low","normal","high"].includes(x.priority??"")&&
   typeof x.due==="string"&&validDate(x.due)&&
   ["none","daily","weekly","monthly"].includes(x.repeat??"")&&
   Array.isArray(x.subtasks)&&x.subtasks.length<=40&&x.subtasks.every(s=>
    s&&typeof s.id==="string"&&/^[a-zA-Z0-9-]{1,80}$/.test(s.id)&&typeof s.text==="string"&&s.text.length<=160&&typeof s.done==="boolean")&&
   Number.isFinite(x.createdAt)&&Number.isFinite(x.updatedAt)&&
   (x.remindedFor===undefined||typeof x.remindedFor==="string"&&x.remindedFor.length<=10);
 });
}
export function nextDue(due:string,repeat:DelaTask["repeat"]):string {
 if(!due||repeat==="none")return "";
 const d=new Date(due+"T12:00:00Z");
 if(Number.isNaN(d.getTime()))return "";
 if(repeat==="daily")d.setUTCDate(d.getUTCDate()+1);
 if(repeat==="weekly")d.setUTCDate(d.getUTCDate()+7);
 if(repeat==="monthly"){const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}
 return d.toISOString().slice(0,10);
}
export class DelaStore {
 private tasks:DelaTask[]=[];
 private readonly file:string;
 private pending:Promise<void>=Promise.resolve();
 constructor(dataDir:string){this.file=path.join(dataDir,"dela-tasks.json");}
 async init():Promise<void>{
  try{this.tasks=parseDela(JSON.parse(await readFile(this.file,"utf8")));}
  catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 }
 private async persist():Promise<void>{
  const file=this.file,temp=file+"."+randomUUID()+".tmp";
  await mkdir(path.dirname(file),{recursive:true});
  try{await writeFile(temp,JSON.stringify(this.tasks),{encoding:"utf8",flag:"wx"});await rename(temp,file);}
  catch(e){const {rm}=await import("node:fs/promises");await rm(temp,{force:true});throw e;}
 }
 private async modify<T>(fn:()=>T):Promise<T>{
  const op=this.pending.then(async()=>{const before=structuredClone(this.tasks);try{const value=fn();await this.persist();return value;}catch(e){this.tasks=before;throw e;}});
  this.pending=op.then(()=>{},()=>{});
  return op;
 }
 async list():Promise<DelaTask[]>{await this.pending;return structuredClone(this.tasks);}
 async change(payload:unknown):Promise<DelaTask[]>{
  const x=payload as {action?:unknown;task?:unknown;id?:unknown}|null;
  if(!x||typeof x!=="object")throw new AppError({code:"VALIDATION",message:"Invalid tasks request"});
  return this.modify(()=>{
   if(x.action==="delete"){
    if(typeof x.id!=="string")throw new AppError({code:"VALIDATION",message:"Invalid task id"});
    this.tasks=this.tasks.filter(t=>t.id!==x.id);
   }else if(x.action==="upsert"){
    const t=parseDela([x.task])[0];
    if(!t)throw new AppError({code:"VALIDATION",message:"Invalid task"});
    const index=this.tasks.findIndex(a=>a.id===t.id);
    if(index>=0)this.tasks[index]=t;
    else {if(this.tasks.length>=500)throw new AppError({code:"CONFLICT",message:"Task limit reached"});this.tasks.unshift(t);}
   }else throw new AppError({code:"VALIDATION",message:"Unknown task action"});
   return structuredClone(this.tasks);
  });
 }
 async dueNotifications(today:string):Promise<{id:string;title:string;detail:string;kind:"info"|"error"}[]>{
  const tasks=await this.list();
  return tasks.filter(t=>t.status!=="done"&&t.due&&t.due<=today).map(t=>({
   id:"dela:"+t.id+":"+t.due,title:t.title,detail:t.due<today?"Просрочено: "+t.due:"Срок сегодня: "+t.due,
   kind:t.due<today?"error" as const:"info" as const
  }));
 }
}
