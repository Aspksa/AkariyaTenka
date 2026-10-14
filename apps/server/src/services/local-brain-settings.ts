import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@akariya/core";

export interface BrainSettings {
  model: string;
  temperature: number;
  topP: number;
  maxCompletionTokens: number;
}
export const defaultBrainSettings: BrainSettings = {
  model: "ai-sage/GigaChat3-10B-A1.8B", temperature: 0.5, topP: 0.95, maxCompletionTokens: 2048
};
function validateSettings(value: unknown): BrainSettings {
  const a = value as Partial<BrainSettings> | null;
  if (!a || typeof a.model !== "string" || !/^[\w./-]{2,150}$/.test(a.model) ||
    typeof a.temperature !== "number" || !Number.isFinite(a.temperature) || a.temperature < 0 || a.temperature > 2 ||
    typeof a.topP !== "number" || !Number.isFinite(a.topP) || a.topP <= 0 || a.topP > 1 ||
    typeof a.maxCompletionTokens !== "number" || !Number.isInteger(a.maxCompletionTokens) || (a.maxCompletionTokens ?? 0) < 64 || (a.maxCompletionTokens ?? 0) > 16384)
    throw new AppError({code:"VALIDATION",message:"Invalid brain settings"});
  return {model:a.model,temperature:a.temperature,topP:a.topP,maxCompletionTokens:a.maxCompletionTokens!};
}

// DPAPI CurrentUser encryption: the key never appears in a process command line or on disk as plaintext.
async function dpapi(mode: "protect" | "unprotect", input: string): Promise<string> {
  if (process.platform !== "win32")
    throw new AppError({code:"CONFLICT",message:"Local key vault currently requires Windows DPAPI"});
  const script = mode === "protect" ?
    '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); $o=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))' :
    '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v.Trim()); $o=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($o))';
  const args = ["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")];
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",args,{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="", errors="";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data",(v:string)=>{output+=v;if(output.length>30000)child.kill();});
    child.stderr.on("data",(v:string)=>{errors+=v;if(errors.length>30000)child.kill();});
    child.on("error",()=>reject(new AppError({code:"INTERNAL",message:"Windows credential protection unavailable"})));
    child.on("close",code=>code===0?resolve(output):reject(new AppError({code:"INTERNAL",message:"Windows credential protection failed"})));
    child.stdin.end(input);
  });
}
export class LocalBrainSettings {
  private readonly settingPath: string;
  private readonly keyPath: string;
  constructor(private readonly dataDir: string) {
    this.settingPath = path.join(dataDir,"brain-settings.json");
    this.keyPath = path.join(dataDir,"cloudru-key.dpapi");
  }
  async readSettings():Promise<BrainSettings> {
    try {return validateSettings(JSON.parse(await readFile(this.settingPath,"utf8")));}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return {...defaultBrainSettings};throw error;}
  }
  async saveSettings(value:unknown):Promise<BrainSettings> {
    const config=validateSettings(value);
    await mkdir(this.dataDir,{recursive:true});
    const temp=this.settingPath+"."+randomUUID()+".tmp";
    try {await writeFile(temp,JSON.stringify(config)+"\n",{mode:0o600,flag:"wx"});await rename(temp,this.settingPath);}
    finally {await rm(temp,{force:true});}
    return config;
  }
  async hasKey():Promise<boolean> {
    try {await readFile(this.keyPath);return true;}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
  }
  async readKey():Promise<string|null> {
    let ciphertext:string;
    try {ciphertext=await readFile(this.keyPath,"utf8");}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
    return dpapi("unprotect",ciphertext);
  }
  async saveKey(value:unknown):Promise<void> {
    if(typeof value!=="string"||value.length<12||value.length>4096||/[\r\n]/.test(value))
      throw new AppError({code:"VALIDATION",message:"Invalid Cloud.ru key"});
    const ciphertext=await dpapi("protect",value);
    await mkdir(this.dataDir,{recursive:true});
    const temp=this.keyPath+"."+randomUUID()+".tmp";
    try {await writeFile(temp,ciphertext,{mode:0o600,flag:"wx"});await rename(temp,this.keyPath);}
    finally {await rm(temp,{force:true});}
  }
  async deleteKey():Promise<void>{await rm(this.keyPath,{force:true});}
}
