import {readdir,readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readPortableIdentity} from "./portable-identity.mjs";
// Discovery never alters volumes or assumes a fixed drive letter.
export async function discoverPortableProjects({roots}={}) {
 const candidates=roots??(process.platform==="win32"?
   "DEFGHIJKLMNOPQRSTUVWXYZ".split("").map(x=>x+":\\"):
   ["/media","/mnt","/Volumes"]);
 const found=[];
 for(const volume of candidates){
   try {
     const dirs=await readdir(volume,{withFileTypes:true});
     for(const entry of dirs){
       if(!entry.isDirectory()||entry.isSymbolicLink())continue;
       const dir=path.join(volume,entry.name);
       try{
         const id=await readPortableIdentity(dir);
         if(id&&await readFile(path.join(dir,"AKARIYA.bat")).then(()=>true).catch(()=>false))
           found.push({path:dir,installationId:id});
       }catch{/* inaccessible or unrelated folder */}
     }
   }catch{/* absent removable drive or denied permission */}
 }
 return found;
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self) discoverPortableProjects().then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
