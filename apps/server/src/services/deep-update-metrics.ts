import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
const run=promisify(execFile);
const codeExtensions=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".css",".html",".ps1",".py",".sh",".sql"]);
const ignored=new Set([".git",".runtime",".updates","node_modules","dist","data","coverage"]);
async function git(root:string,args:string[]):Promise<string>{
 const result=await run("git",["-C",root,...args],{encoding:"utf8",timeout:20000,maxBuffer:16*1024*1024,windowsHide:true});
 return result.stdout;
}
type Item={label:string;value:string|null;detail:string};
export interface DeepMetrics { measuredAt:string;sections:{title:string;metrics:Item[]}[];caveats:string[] }
const n=(value:number)=>value.toLocaleString("ru-RU");
let cached:{root:string;time:number;task:Promise<DeepMetrics>}|undefined;
export function deepUpdateMetrics(root:string):Promise<DeepMetrics>{
 if(cached?.root===root&&Date.now()-cached.time<600000)return cached.task;
 const task=calculate(root);cached={root,time:Date.now(),task};
 void task.catch(()=>{if(cached?.task===task)cached=undefined;});
 return task;
}
async function calculate(root:string):Promise<DeepMetrics>{
 const rootPath=path.resolve(root),files:{name:string;text:string}[]=[];
 let backupsBytes=0,backupsCount=0;
 async function walk(directory:string,relative="",depth=0):Promise<void>{
  if(depth>16||files.length>12000)return;
  let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   if(ignored.has(entry.name))continue;
   const rel=relative?relative+"/"+entry.name:entry.name;
   if(entry.isSymbolicLink())continue;
   if(entry.isDirectory())await walk(path.join(directory,entry.name),rel,depth+1);
   else if(entry.isFile()&&codeExtensions.has(path.extname(entry.name).toLowerCase())){
    const p=path.join(directory,entry.name);
    try{const st=await lstat(p);if(st.size>2*1024*1024)continue;
      const text=await readFile(p,"utf8");if(!text.includes("\0"))files.push({name:rel,text});
    }catch{/* unreadable source excluded */}
   }
  }
 }
 await walk(rootPath);
 let functions=0,classes=0,types=0,exports=0,comments=0,blank=0,cssRules=0;
 let regexes=0,emoji=0,longestLine=0,imports=0;const colors=new Set<string>(),edges=new Set<string>();
 let longestIdentifier="";let allLines=0;
 for(const file of files){
  const t=file.text,lines=t.split(/\r?\n/u);allLines+=lines.length;
  functions+=(t.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/gu)?.length??0)+(t.match(/(?:=|:)\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/gu)?.length??0);
  classes+=t.match(/\bclass\s+[A-Za-z_$][\w$]*/gu)?.length??0;
  types+=t.match(/\b(?:interface|type)\s+[A-Za-z_$][\w$]*/gu)?.length??0;
  exports+=t.match(/\bexport\s+(?:(?:default|declare|async)\s+)*(?:class|interface|type|function|const|let|var|enum)\b/gu)?.length??0;
  regexes+=t.match(/\/[^\n/]+\/[dgimsuvy]*/gu)?.length??0;
  emoji+=t.match(/\p{Extended_Pictographic}/gu)?.length??0;
  for(const line of lines){
   longestLine=Math.max(longestLine,[...line].length);
   if(!line.trim())blank++;
   if(/^\s*(?:\/\/|\/\*|\*|#(?!include))/u.test(line))comments++;
  }
  if(path.extname(file.name)===".css"){
   cssRules+=t.match(/[^{}]+\{/gu)?.length??0;
   for(const c of t.matchAll(/(?:#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\([^)]*\))/gu))colors.add(c[0].toLowerCase());
  }
  const id=/\b(?:function|const|let|var|class|interface|type)\s+([A-Za-z_$][\w$]*)/gu;
  for(const m of t.matchAll(id))if((m[1]?.length??0)>longestIdentifier.length)longestIdentifier=m[1]!;
  const imp=/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/gu;
  for(const m of t.matchAll(imp)){imports++;edges.add(file.name+" -> "+m[1]);}
 }
 let npmDependencies=0;try{
  const p=JSON.parse(await readFile(path.join(rootPath,"package.json"),"utf8")) as {dependencies?:object;devDependencies?:object};
  npmDependencies=Object.keys(p.dependencies??{}).length+Object.keys(p.devDependencies??{}).length;
 }catch{/* package unavailable */}
 let hasHistory=false,king:string|null=null,bigBang:string|null=null,bigDay:string|null=null,favorite:string|null=null,magic:string|null=null;
 let cold:number|null=null,ancient:number|null=null;let removedFunctions:string|null=null;
 let branches:number|null=null;
 try{
  hasHistory=(await git(rootPath,["rev-parse","--is-inside-work-tree"])).trim()==="true";
  if(hasHistory){
   const log=await git(rootPath,["log","--all","--format=@@%H %ct %s","--numstat","--no-renames"]);
   let hash="",date=0,title="",changes=0,added=0,deleted=0;
   const modules=new Map<string,number>(),days=new Map<string,number>(),wordCounts=new Map<string,number>();
   let maxFiles=0,maxHash="",maxSubject="";
   const flush=()=>{if(!hash)return;const day=new Date(date*1000).toISOString().slice(0,10);days.set(day,(days.get(day)??0)+added-deleted);
    if(changes>maxFiles){maxFiles=changes;maxHash=hash;maxSubject=title;}
    for(const w of title.toLowerCase().match(/[\p{L}]{3,}/gu)??[])wordCounts.set(w,(wordCounts.get(w)??0)+1);
   };
   for(const line of log.split(/\r?\n/u)){
    if(line.startsWith("@@")){flush();const m=/^@@([a-f0-9]{40}) (\d+) (.*)$/u.exec(line);hash=m?.[1]??"";date=Number(m?.[2]);title=m?.[3]??"";changes=0;added=0;deleted=0;continue;}
    const m=/^(\d+)\t(\d+)\t(.+)$/u.exec(line);if(!m)continue;
    changes++;added+=Number(m[1]);deleted+=Number(m[2]);const module=m[3]!.split("/").slice(0,2).join("/");
    modules.set(module,(modules.get(module)??0)+1);
   }flush();
   const largest=[...modules].sort((a,b)=>b[1]-a[1])[0];
   if(largest)king=largest[0]+" — "+n(largest[1])+" изменений";
   if(maxHash)bigBang=maxHash.slice(0,12)+" — "+n(maxFiles)+" файлов"+(maxSubject?" ("+maxSubject.slice(0,70)+")":"");
   const day=[...days].sort((a,b)=>b[1]-a[1])[0];if(day)bigDay=day[0]+" — +"+n(day[1])+" строк";
   const word=[...wordCounts].sort((a,b)=>b[1]-a[1])[0];if(word)favorite=word[0]+" — "+n(word[1]);
   const commits=await git(rootPath,["log","--all","--format=%h","-n","1500"]);
   const special=commits.split(/\r?\n/u).filter(s=>/^([a-f])\1{3}/u.test(s));
   magic=special.length?n(special.length)+" хешей с четырьмя одинаковыми начальными символами":"Совпадений не найдено";
   branches=(await git(rootPath,["branch","--list","--all","--format=%(refname)"])).split(/\r?\n/u).filter(Boolean).length;
   const timestamps=await git(rootPath,["log","-1","--format=%ct","--",...files.slice(0,150).map(f=>f.name)]);
   void timestamps;
   cold=0;const cutoff=Date.now()/1000-90*86400;
   for(const file of files.slice(0,200)){
     try{const timestamp=Number((await git(rootPath,["log","-1","--format=%ct","--",file.name])).trim());if(timestamp>0&&timestamp<cutoff)cold++;}catch{/* missing */}
   }
  }
 }catch{/* Missing Git or exceeded analysis limit: don't fabricate history */}
 // GitHub PRs and releases require network/API access and are not inferred from local refs.
 const updates=path.join(rootPath,".runtime","github-updater");
 try{
  async function measure(dir:string,depth=0):Promise<void>{
   if(depth>9)return;
   for(const e of await readdir(dir,{withFileTypes:true})){
    if(e.isSymbolicLink())continue;
    const name=path.join(dir,e.name);
    if(e.isDirectory())await measure(name,depth+1);
    else if(e.isFile()){const st=await lstat(name);backupsBytes+=st.size;backupsCount++;}
   }
  }
  await measure(path.join(updates,"backups"));
 }catch{/* no updater backups */}
 let successful:number|null=null;
 try{
  const events=(await readFile(path.join(updates,"history.jsonl"),"utf8")).trim().split(/\r?\n/u).slice(-5000);
  let prepared=0,confirmed=0;
  for(const line of events){try{const v=JSON.parse(line) as {event?:string};if(v.event==="prepared")prepared++;if(v.event==="confirmed")confirmed++;}catch{/* corrupt entry */}}
  if(prepared>0)successful=Math.round(Math.min(1,confirmed/prepared)*1000)/10;
 }catch{/* no event history */}
 let downloadSpeed:string|null=null,preparation:string|null=null,rollbackTime:string|null=null;
 try {
  const file=path.join(updates,"telemetry.jsonl");
  const info=await lstat(file);
  if(info.isFile()&&!info.isSymbolicLink()&&info.size<=1048576){
   const lines=(await readFile(file,"utf8")).split("\n").slice(-4000);
   for(const line of lines){
    let entry:unknown;try{entry=JSON.parse(line);}catch{continue;}
    if(!entry||typeof entry!=="object")continue;
    const v=entry as {event?:unknown;bytes?:unknown;durationMs?:unknown};
    if(typeof v.durationMs!=="number"||!Number.isFinite(v.durationMs)||v.durationMs<=0||v.durationMs>86400000)continue;
    if(v.event==="download_complete"&&typeof v.bytes==="number"&&Number.isSafeInteger(v.bytes)&&v.bytes>=0)
     downloadSpeed=(v.bytes/1048576/(v.durationMs/1000)).toFixed(2)+" МиБ/с";
    if(v.event==="prepared")preparation=(v.durationMs/1000).toFixed(1)+" с";
    if(v.event==="rollback_complete")rollbackTime=(v.durationMs/1000).toFixed(1)+" с";
   }
  }
 }catch{/* no telemetry on older installations */}
 const unavailable="Не измеряется текущей версией updater";
 const metric=(label:string,value:string|null,detail:string):Item=>({label,value,detail});
 return {measuredAt:new Date().toISOString(),caveats:[
  "Синтаксические метрики основаны на поиске конструкций в исходных файлах, без AST; значения приблизительные.",
  "Git-история отражает доступные локальные ветки и коммиты, а не удалённые ветки GitHub.",
  "Без событий с таймстампами и счётчиками байтов некоторые метрики updater невозможно восстановить задним числом."
 ],sections:[
  {title:"📜 История и рекорды",metrics:[
   metric("👑 Король изменений",king,"Модуль с максимальным числом Git-изменений"),
   metric("🦖 Древнейший код",ancient===null?null:n(ancient),"Пока нет blame-анализа начальных строк"),
   metric("👻 Призраки прошлого",removedFunctions,"Требуется сопоставление AST между ревизиями"),
   metric("🧬 Эволюционный скачок",bigDay,"Максимальный чистый прирост строк за день"),
   metric("🧊 Замороженные файлы",cold===null?null:n(cold),"Не изменялись более 90 дней, до 200 файлов"),
   metric("🧨 Большой взрыв",bigBang,"Коммит с максимальным числом изменённых файлов"),
   metric("🌌 Вселенная зависимостей",n(imports)+" импортов / "+n(edges.size)+" связей","Статический поиск import/export"),
   metric("💎 Редкие достижения",magic,"Редкие совпадения в коротких хешах"),
   metric("🌳 Дерево поколений",hasHistory?n(branches??0)+" Git-ссылок":null,"PR и релизы недоступны без GitHub API"),
   metric("📖 Книга жизни",bigBang&&bigDay?"Крупнейший коммит: "+bigBang+"; день роста: "+bigDay:null,"Краткая автоматическая хроника"),
   metric("😀 Эмодзи в коде",n(emoji),"Unicode pictographic символы"),
   metric("📐 Самая длинная строка",n(longestLine)+" символов","Unicode кодовые точки"),
   metric("🐍 Самое длинное имя",longestIdentifier||null,"Поиск объявлений"),
   metric("🔤 Любимое слово",favorite,"В сообщениях Git-коммитов"),
   metric("🔮 Магия хешей",magic,"Повторяющиеся начальные символы")
  ]},
  {title:"🔬 Код под микроскопом",metrics:[
   metric("🧮 Функции",n(functions),"function и стрелочные функции, приблизительно"),
   metric("🏛️ Классы",n(classes),"Объявления class"),
   metric("📐 Типы",n(types),"Объявления interface и type"),
   metric("📤 Экспорты",n(exports),"Экспортируемые объявления"),
   metric("💬 Комментарии",n(comments)+" строк ("+(allLines?Math.round(comments/allLines*1000)/10:0)+"%)","Строки с признаками комментариев"),
   metric("🌫️ Воздух",n(blank)+" строк","Пустые строки"),
   metric("🖌️ Стили",n(cssRules)+" правил","CSS-блоки"),
   metric("🌈 Палитра",n(colors.size)+" цветов","Уникальные CSS hex/rgb/hsl значения"),
   metric("🧵 Регулярные выражения",n(regexes),"Эвристический поиск regex-литералов"),
   metric("📦 Зависимости",n(npmDependencies),"dependencies + devDependencies корневого package.json")
  ]},
  {title:"⚙️ Измерения updater",metrics:[
   metric("📡 Скорость обнаружения обновления",null,unavailable+" — нужны времена публикации и проверки"),
   metric("⬇️ Скорость загрузки",downloadSpeed,downloadSpeed?"Последняя завершённая загрузка":"Нет измерений загрузки"),
   metric("♻️ Повторное использование",null,"Текущий updater скачивает полный архив; доля совпадений не измеряется"),
   metric("🔎 Скорость проверки хешей",null,unavailable),
   metric("🧪 Время подготовки",preparation,"От старта updater до prepared"),
   metric("⏸️ Простой при установке",null,unavailable+" — нужны замеры недоступности"),
   metric("✅ Успешность обновлений",successful===null?null:n(successful)+"%","Приблизительно: confirmed/prepared по локальному журналу"),
   metric("🛟 Время восстановления после rollback",rollbackTime,"Файловый rollback; запуск сервера не включён"),
   metric("📦 Эффективность дельты",null,"Загрузка полного архива; метрика дельты неприменима"),
   metric("🗄️ Вес резервных копий",n(backupsBytes)+" байт","Объём "+n(backupsCount)+" файлов в локальных backups")
  ]}
 ]};
}
