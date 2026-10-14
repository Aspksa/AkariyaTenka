import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, sign, verify } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { importPublisherKey } from "./import-publisher-key.mjs";
import { unsealProjectSecret } from "./portable-key-vault.mjs";
const PASS="example passphrase used in test suite only";
async function fixture() {
 const base=await mkdtemp(path.join(os.tmpdir(),"akariya-keys-"));
 const source=path.join(base,"outside"),root=path.join(base,"project");
 await mkdir(source);await mkdir(root);
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 const der=publicKey.export({format:"der",type:"spki"});
 await writeFile(path.join(source,"publisher-private.pem"),privateKey.export({format:"pem",type:"pkcs8"}));
 await writeFile(path.join(source,"publisher-public.pem"),publicKey.export({format:"pem",type:"spki"}));
 await writeFile(path.join(source,"publisher-spki-sha256.txt"),createHash("sha256").update(der).digest("hex")+"\n");
 return {base,source,root};
}
test("imports existing Ed25519 pair only as encrypted project private material",async()=>{
 const {base,source,root}=await fixture();
 try{
  const result=await importPublisherKey(root,source,PASS);
  assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
  const vault=await readFile(path.join(root,"keys/private/signing-vault.enc"),"utf8");
  assert.equal(vault.includes("BEGIN PRIVATE KEY"),false);
  const recovered=createPrivateKey(await unsealProjectSecret(root,PASS));
  const pub=createPublicKey(await readFile(path.join(root,"keys/public/publisher-public.pem")));
  const message=Buffer.from("sign-test");
  assert.equal(verify(null,message,pub,sign(null,message,recovered)),true);
  await assert.rejects(importPublisherKey(root,source,PASS),/refusing to overwrite/);
  await assert.rejects(unsealProjectSecret(root,"incorrect-passphrase"),/auth|authenticate/i);
 }finally{await rm(base,{recursive:true,force:true});}
});
test("rejects corrupted public fingerprint without writing key files",async()=>{
 const {base,source,root}=await fixture();
 try{
  await writeFile(path.join(source,"publisher-spki-sha256.txt"),"0".repeat(64)+"\n");
  await assert.rejects(importPublisherKey(root,source,PASS),/fingerprint/);
  await assert.rejects(readFile(path.join(root,"keys/private/signing-vault.enc")),{code:"ENOENT"});
 }finally{await rm(base,{recursive:true,force:true});}
});
