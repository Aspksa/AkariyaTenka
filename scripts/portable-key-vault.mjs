import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const NAME="keys/private/signing-vault.enc";
export async function sealProjectSecret(root,secret,passphrase){
 if(typeof passphrase!=="string"||passphrase.length<16)throw Error("Passphrase at least 16 characters required");
 if(!Buffer.isBuffer(secret)||secret.length===0||secret.length>64*1024)throw Error("Invalid secret");
 const salt=randomBytes(32),iv=randomBytes(12),key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const cipher=createCipheriv("aes-256-gcm",key,iv);
 const bytes=Buffer.concat([cipher.update(secret),cipher.final()]);
 const data=JSON.stringify({schemaVersion:1,kdf:"scrypt",cipher:"aes-256-gcm",salt:salt.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:bytes.toString("base64")})+"\n";
 const target=path.join(root,NAME);await mkdir(path.dirname(target),{recursive:true,mode:0o700});
 await writeFile(target,data,{flag:"wx",mode:0o600});
 return {created:true,location:NAME};
}
export async function unsealProjectSecret(root,passphrase){
 const content=await readFile(path.join(root,NAME),"utf8");
 if(content.length>100000)throw Error("Vault oversized");
 const o=JSON.parse(content);
 if(o.schemaVersion!==1||o.kdf!=="scrypt"||o.cipher!=="aes-256-gcm")throw Error("Unknown vault scheme");
 const decode=(name,len)=>{if(typeof o[name]!=="string"||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(o[name]))throw Error("Invalid vault");
 const buf=Buffer.from(o[name],"base64");if(len&&buf.length!==len)throw Error("Invalid vault");return buf;};
 const key=scryptSync(passphrase,decode("salt",32),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const decipher=createDecipheriv("aes-256-gcm",key,decode("iv",12));
 decipher.setAuthTag(decode("tag",16));
 return Buffer.concat([decipher.update(decode("ciphertext")),decipher.final()]);
}
const self=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(self){console.error("Vault library only: use an owner-controlled local caller; never pass secret/passphrase on command line.");process.exitCode=2;}
