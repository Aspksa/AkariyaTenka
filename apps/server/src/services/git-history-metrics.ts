import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
const CODE = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".css",".html",".ps1",".bat",".yml",".yaml",".py",".sh",".sql"]);
const SKIP = /^(?:node_modules|data|\.runtime|\.updates|dist|\.git)(?:\/|$)/;
const tokenCount = (s: string): number => s.match(/[\p{L}\p{N}_]+(?:[-'][\p{L}\p{N}_]+)*/gu)?.length ?? 0;
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted=[...values].sort((a,b)=>a-b);const mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid]! : (sorted[mid-1]!+sorted[mid]!)/2;
};
export interface HistoryMetrics {
  available: boolean; reason?: string;
  wordsAdded: number|null; wordsDeleted: number|null; wordsRewritten: number|null;
  newFiles: number|null; deletedFiles: number|null;
  largestFile: {path:string;lines:number}|null;
  smallestCodeFile: {path:string;lines:number}|null;
  oldestUntouchedFile: {path:string;lastChanged:string}|null;
  hottestFile: {path:string;commits:number}|null;
  biggestGrowth: {path:string;netLines:number}|null;
  languages: {extension:string;lines:number}[];
  averageCodeLines: number|null; medianCodeLines: number|null;
  directories: number; averageFilesPerDirectory: number;
  markdownLines: number; jsonFiles: number; jsonBytes: number;
  /** Project timeline: totals, rhythm by hour/weekday and a 26-week daily activity map. */
  commits: number|null; authors: number|null;
  firstCommitAt: string|null; lastCommitAt: string|null;
  activeDays: number|null; longestStreak: number|null;
  hours: number[]|null; weekdays: number[]|null;
  activity: {date:string;commits:number}[]|null;
}
const dayKey=(d:Date):string=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
/** Commits per local calendar day for the last 26 full weeks, oldest first, starting on a Monday. */
export function activityMap(timestamps:number[],now=new Date()):{date:string;commits:number}[]{
 const counts=new Map<string,number>();
 for(const t of timestamps)counts.set(dayKey(new Date(t*1000)),(counts.get(dayKey(new Date(t*1000)))??0)+1);
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 start.setDate(start.getDate()-((start.getDay()+6)%7)-25*7);
 const days:{date:string;commits:number}[]=[];
 for(const d=new Date(start);d<=now;d.setDate(d.getDate()+1))days.push({date:dayKey(d),commits:counts.get(dayKey(d))??0});
 return days;
}
/** Longest run of consecutive local calendar days that contain at least one commit. */
export function longestStreak(timestamps:number[]):number{
 const days=[...new Set(timestamps.map(t=>{const d=new Date(t*1000);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;}))].sort((a,b)=>a-b);
 let best=0,run=0;
 for(let i=0;i<days.length;i++){run=i&&days[i]===days[i-1]!+1?run+1:1;best=Math.max(best,run);}
 return best;
}
async function git(root:string,...args:string[]):Promise<string>{
 const {stdout}=await exec("git",["-C",root,...args],{timeout:45_000,maxBuffer:48*1024*1024,encoding:"utf8",windowsHide:true});
 return stdout;
}
let cache:{root:string;at:number;promise:Promise<HistoryMetrics>}|null=null;
export function gitHistoryMetrics(root:string):Promise<HistoryMetrics>{
 if(cache?.root===root && Date.now()-cache.at<10*60_000)return cache.promise;
 const promise=calculate(root);
 cache={root,at:Date.now(),promise};
 promise.catch(()=>{if(cache?.promise===promise)cache=null;});
 return promise;
}
async function calculate(root:string):Promise<HistoryMetrics>{
 let paths:string[]=[];
 let history=true;let reason: string|undefined;
 try{
  if((await git(root,"rev-parse","--is-inside-work-tree")).trim()!=="true")throw Error("No Git working tree");
  paths=(await git(root,"ls-files","-z")).split("\0").filter(Boolean);
 }catch{
  history=false;reason="Нет доступной истории Git (например, проект распакован из ZIP). Исторические показатели недоступны; текущие файлы подсчитаны.";
  const walk=async(dir:string,relative:string,depth:number):Promise<void>=>{
   if(depth>16||paths.length>15000)return;
   let items;try{items=await readdir(dir,{withFileTypes:true});}catch{return;}
   for(const item of items){
    if(item.isSymbolicLink())continue;
    const p=relative?relative+"/"+item.name:item.name;
    if(SKIP.test(p) || [".git",".updates",".runtime","node_modules","dist","coverage"].includes(item.name))continue;
    if(item.isDirectory())await walk(path.join(dir,item.name),p,depth+1);
    else if(item.isFile())paths.push(p);
   }
  };
  await walk(root,"",0);
 }
 const valid=paths.filter(p=>!SKIP.test(p) && !p.split("/").includes(".."));
 const sizes=new Map<string,number>(), languages=new Map<string,number>();
 let markdownLines=0,jsonFiles=0,jsonBytes=0;
 const dirs=new Set<string>();const directoryFiles=new Map<string,number>();
 for(const p of valid){
  const full=path.resolve(root,p);
  if(!full.startsWith(path.resolve(root)+path.sep))continue;
  let info;try{info=await stat(full);}catch{continue;}
  if(!info.isFile()||info.size>3*1024*1024)continue;
  const extension=path.extname(p).toLowerCase();
  const segments=p.split("/");for(let i=1;i<segments.length;i++){
    const dir=segments.slice(0,i).join("/");dirs.add(dir);
  }
  const parent=segments.length>1?segments.slice(0,-1).join("/"):"(root)";
  directoryFiles.set(parent,(directoryFiles.get(parent)??0)+1);
  if(extension===".json"){jsonFiles++;jsonBytes+=info.size;}
  if(!CODE.has(extension)&&extension!==".md")continue;
  try{
   const text=await readFile(full,"utf8");
   if(text.includes("\0"))continue;
   const lines=text.length?text.split(/\r?\n/u).length-(text.endsWith("\n")?1:0):0;
   if(extension===".md")markdownLines+=lines;
   if(CODE.has(extension)){sizes.set(p,lines);languages.set(extension,(languages.get(extension)??0)+lines);}
  }catch{/* inaccessible tracked file */}
 }
 const entries=[...sizes].filter(([,lines])=>lines>0);
 const codeEntries=entries.filter(([p])=>![".json",".yml",".yaml"].includes(path.extname(p).toLowerCase()));
 const biggest=entries.reduce<[string,number]|null>((best,item)=>!best||item[1]>best[1]?item:best,null);
 const smallest=codeEntries.reduce<[string,number]|null>((best,item)=>!best||item[1]<best[1]?item:best,null);
 const lineValues=codeEntries.map(([,v])=>v);
 const base:HistoryMetrics={
  available:history,...(reason?{reason}:{}),
  wordsAdded:null,wordsDeleted:null,wordsRewritten:null,newFiles:null,deletedFiles:null,
  largestFile:biggest?{path:biggest[0],lines:biggest[1]}:null,
  smallestCodeFile:smallest?{path:smallest[0],lines:smallest[1]}:null,
  oldestUntouchedFile:null,hottestFile:null,biggestGrowth:null,
  languages:[...languages].map(([extension,lines])=>({extension,lines})).sort((a,b)=>b.lines-a.lines),
  averageCodeLines:lineValues.length?Math.round(lineValues.reduce((a,b)=>a+b,0)/lineValues.length*10)/10:null,
  medianCodeLines:lineValues.length?median(lineValues):null,
  directories:dirs.size,averageFilesPerDirectory:directoryFiles.size?Math.round(valid.length/directoryFiles.size*10)/10:0,
  markdownLines,jsonFiles,jsonBytes,
  commits:null,authors:null,firstCommitAt:null,lastCommitAt:null,activeDays:null,longestStreak:null,
  hours:null,weekdays:null,activity:null
 };
 if(!history)return base;
 try{
  // Rhythm of the project: distinct commits across all local refs, counted once each.
  const log=await git(root,"log","--all","--format=%ct\t%aN");
  const stamps:number[]=[];const people=new Set<string>();
  for(const line of log.split(/\r?\n/u)){
   const [time,name]=line.split("\t");const t=Number(time);
   if(!Number.isFinite(t)||t<=0)continue;
   stamps.push(t);if(name)people.add(name.trim().toLowerCase());
  }
  if(stamps.length){
   const hours=Array.from({length:24},()=>0),weekdays=Array.from({length:7},()=>0);
   for(const t of stamps){const d=new Date(t*1000);hours[d.getHours()]!++;weekdays[(d.getDay()+6)%7]!++;}
   base.commits=stamps.length;base.authors=people.size;
   base.firstCommitAt=new Date(stamps.reduce((a,b)=>Math.min(a,b))*1000).toISOString();
   base.lastCommitAt=new Date(stamps.reduce((a,b)=>Math.max(a,b))*1000).toISOString();
   base.activeDays=new Set(stamps.map(t=>dayKey(new Date(t*1000)))).size;
   base.longestStreak=longestStreak(stamps);
   base.hours=hours;base.weekdays=weekdays;base.activity=activityMap(stamps);
  }else{base.commits=0;base.authors=0;}
 }catch{/* rhythm is optional; the remaining history is still calculated */}
 try{
  // One history traversal for file births, deletions, modification frequency and line growth.
  const historyText=await git(root,"log","--all","--format=@@%ct","--name-status","--find-renames");
  const touches=new Map<string,number>(),lastChanged=new Map<string,number>();
  let timestamp=0,births=0,deaths=0;
  for(const line of historyText.split(/\r?\n/u)){
   if(line.startsWith("@@")){timestamp=Number(line.slice(2));continue;}
   const parts=line.split("\t");if(parts.length<2)continue;
   const code=parts[0]??"";const filename=parts[parts.length-1]??"";
   if(code==="A")births++;
   if(code==="D")deaths++;
   if(!filename||SKIP.test(filename))continue;
   touches.set(filename,(touches.get(filename)??0)+1);
   if(!lastChanged.has(filename)&&timestamp>0)lastChanged.set(filename,timestamp);
  }
  base.newFiles=births;base.deletedFiles=deaths;
  const hot=[...touches].filter(([p])=>sizes.has(p)).sort((a,b)=>b[1]-a[1])[0];
  if(hot)base.hottestFile={path:hot[0],commits:hot[1]};
  const old=[...lastChanged].filter(([p])=>sizes.has(p)).sort((a,b)=>a[1]-b[1])[0];
  if(old)base.oldestUntouchedFile={path:old[0],lastChanged:new Date(old[1]*1000).toISOString()};
  const stats=await git(root,"log","--all","--numstat","--format=");
  const growth=new Map<string,number>();
  for(const line of stats.split(/\r?\n/u)){
   const m=/^(\d+)\t(\d+)\t(.+)$/u.exec(line);if(!m)continue;
   const p=m[3]!;if(!sizes.has(p))continue;
   growth.set(p,(growth.get(p)??0)+Number(m[1])-Number(m[2]));
  }
  const grown=[...growth].sort((a,b)=>b[1]-a[1])[0];
  if(grown)base.biggestGrowth={path:grown[0],netLines:grown[1]};
  // Word-diff porcelain markers: '+' means added text and '-' removed text.
  // Rewrites are an estimate of words replaced, pairing addition/deletion per diff hunk.
  const diff=await git(root,"log","--all","--format=@@COMMIT","--word-diff=porcelain","--unified=0","--no-ext-diff");
  let added=0,removed=0,replaced=0,hunkAdded=0,hunkRemoved=0;
  const flush=()=>{replaced+=Math.min(hunkAdded,hunkRemoved);hunkAdded=0;hunkRemoved=0;};
  for(const line of diff.split(/\r?\n/u)){
   if(line.startsWith("@@")||line.startsWith("diff --git")||line==="@@COMMIT"){flush();continue;}
   if(line.startsWith("+++")||line.startsWith("---")||line.startsWith("~"))continue;
   if(line.startsWith("+")){const n=tokenCount(line.slice(1));added+=n;hunkAdded+=n;}
   else if(line.startsWith("-")){const n=tokenCount(line.slice(1));removed+=n;hunkRemoved+=n;}
  }
  flush();base.wordsAdded=added;base.wordsDeleted=removed;base.wordsRewritten=replaced;
 }catch{
  base.available=false;base.reason="История Git доступна, но полный расчёт не завершён (ограничение времени или объёма).";
 }
 return base;
}
