import {randomUUID} from "node:crypto";
import {readFile,mkdir,writeFile,rename,rm} from "node:fs/promises";
import path from "node:path";
import {AppError} from "@akariya/core";
import type {DelaStore} from "./dela-store.js";

export type AutomationRule={id:"due"|"overdue";enabled:boolean};
export type AutomationEvent={id:string;rule:"due"|"overdue";taskId:string;date:string;at:string;title:string};
type State={rules:AutomationRule[];events:AutomationEvent[]};
const defaults=():AutomationRule[]=>[{id:"due",enabled:true},{id:"overdue",enabled:true}];
const datePattern=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export class DelaAutomation {
 private state:State={rules:defaults(),events:[]};
 private readonly file:string;
 private queue:Promise<void>=Promise.resolve();
 constructor(dataDir:string,private readonly tasks:DelaStore){this.file=path.join(dataDir,"dela-automation.json");}
 async init():Promise<void>{
  try{
   const raw=JSON.parse(await readFile(this.file,"utf8")) as Partial<State>;
   if(!raw||!Array.isArray(raw.rules)||!Array.isArray(raw.events))throw Error("Invalid automation storage");
   for(const r of defaults()){
    const saved=raw.rules.find(x=>x&&x.id===r.id&&typeof x.enabled==="boolean");
    if(saved)r.enabled=saved.enabled;
   }
   this.state.rules=defaults().map(r=>({id:r.id,enabled:raw.rules!.find(x=>x?.id===r.id)?.enabled===false?false:true}));
   this.state.events=raw.events.filter(e=>e&&typeof e.id==="string"&&typeof e.at==="string"&&typeof e.taskId==="string"&&
    typeof e.title==="string"&&datePattern.test(e.date)&&["due","overdue"].includes(e.rule)).slice(-1000);
  }catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 }
 private async persist():Promise<void>{
  await mkdir(path.dirname(this.file),{recursive:true});
  const tmp=this.file+"."+randomUUID()+".tmp";
  try{await writeFile(tmp,JSON.stringify(this.state),{encoding:"utf8",flag:"wx"});await rename(tmp,this.file);}
  catch(e){await rm(tmp,{force:true});throw e;}
 }
 async snapshot():Promise<State>{await this.queue;return structuredClone(this.state);}
 async setRule(payload:unknown):Promise<State>{
  const p=payload as {id?:unknown;enabled?:unknown}|null;
  if(!p||(p.id!=="due"&&p.id!=="overdue")||typeof p.enabled!=="boolean")
   throw new AppError({code:"VALIDATION",message:"Invalid automation rule"});
  const work=this.queue.then(async()=>{
   const before=structuredClone(this.state);
   try{this.state.rules=this.state.rules.map(r=>r.id===p.id?{...r,enabled:p.enabled as boolean}:r);
    await this.persist();return structuredClone(this.state);}
   catch(e){this.state=before;throw e;}
  });
  this.queue=work.then(()=>{},()=>{});
  return work;
 }
 async tick(today:string):Promise<number>{
  if(!datePattern.test(today))throw new AppError({code:"VALIDATION",message:"Invalid automation date"});
  const tasks=await this.tasks.list();
  const work=this.queue.then(async()=>{
   const before=structuredClone(this.state);
   const known=new Set(this.state.events.map(e=>e.id));
   let added=0;
   for(const t of tasks){
    if(t.status==="done"||!t.due||t.due>today)continue;
    const rule:tRule=t.due===today?"due":"overdue";
    if(!this.state.rules.some(r=>r.id===rule&&r.enabled))continue;
    // Once per task, due date and rule: restarting never repeats an event.
    const id=rule+":"+t.id+":"+t.due;
    if(known.has(id))continue;
    known.add(id);
    this.state.events.push({id,rule,taskId:t.id,date:t.due,at:new Date().toISOString(),title:t.title});
    added++;
   }
   if(!added)return 0;
   this.state.events=this.state.events.slice(-1000);
   try{await this.persist();return added;}
   catch(e){this.state=before;throw e;}
  });
  this.queue=work.then(()=>{},()=>{});
  return work;
 }
}
type tRule="due"|"overdue";
