import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const actionSchema=z.object({
  action:z.enum(["copy","compare","sync-to","sync-from","restore"]),
  other:z.string().min(1).max(1024),
  backupId:z.string().max(100).optional(),
  confirm:z.literal("ПЕРЕНЕСТИ")
}).strict();

export function createPortableActionRoute(root:string,token:string|undefined) {
  return async (payload:unknown):Promise<string> => {
    if(!token || token.length<32) throw Error("Supervised launcher required for portable transfer");
    const parsed=actionSchema.parse(payload);
    if (!path.isAbsolute(parsed.other) || /[\r\n\0]/.test(parsed.other)) throw Error("An absolute local folder path is required");
    const a=path.resolve(root), b=path.resolve(parsed.other);
    const overlaps=(parent:string,child:string):boolean=>{
      const relative=path.relative(parent,child);
      return relative==="" || (relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative));
    };
    if(overlaps(a,b)||overlaps(b,a)) throw Error("Overlapping installations are forbidden");
    if(parsed.action==="restore" && (parsed.backupId===undefined||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(parsed.backupId)))
      throw Error("A valid backup identifier is required");
    if(parsed.action!=="restore"&&parsed.backupId!==undefined)throw Error("Unexpected backup identifier");
    const dir=path.join(root,".portable-state");
    await mkdir(dir,{recursive:true});
    const record={schemaVersion:1,id:randomUUID(),session:createHash("sha256").update(token).digest("hex"),
      action:parsed.action,other:b,...(parsed.backupId===undefined?{}:{backupId:parsed.backupId})};
    await writeFile(path.join(dir,"pending-transfer.json"),JSON.stringify(record)+"\n",{flag:"wx",mode:0o600});
    return JSON.stringify({queued:true,action:parsed.action,id:record.id});
  };
}
