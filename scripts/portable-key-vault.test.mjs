import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {sealProjectSecret,unsealProjectSecret} from "./portable-key-vault.mjs";
test("encrypted key vault roundtrips without exposing plaintext",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"akariya-vault-"));
 try{
  const raw=Buffer.from("private signing material only for unit test");
  await sealProjectSecret(root,raw,"a strong example passphrase 123");
  assert.deepEqual(await unsealProjectSecret(root,"a strong example passphrase 123"),raw);
  await assert.rejects(unsealProjectSecret(root,"not-the-right-password"),/auth|authenticate/i);
  await assert.rejects(sealProjectSecret(root,raw,"a strong example passphrase 123"),/EEXIST/);
 }finally{await rm(root,{recursive:true,force:true});}
});
