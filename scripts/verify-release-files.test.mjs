import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { signReleaseManifest } from "./sign-release.mjs";
import { verifyReleaseFiles } from "./verify-release-files.mjs";

test("publisher signing and release-file verification fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-release-sign-"));
  const {publicKey, privateKey} = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({format:"pem",type:"spki"});
  const privateKeyPem = privateKey.export({format:"pem",type:"pkcs8"});
  const trustedPublicKeySpkiSha256 = createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
  const manifestPath=path.join(root,"manifest.json"),signaturePath=path.join(root,"manifest.sig"),archivePath=path.join(root,"release.zip");
  const contents=Buffer.from("verified fixture");
  const metadata={schemaVersion:1,repository:"Aspksa/AkariyaTenka",tag:"v1.2.3",sourceSha:"a".repeat(40),archiveSha256:createHash("sha256").update(contents).digest("hex"),archiveSize:contents.length};
  try {
    await writeFile(manifestPath,JSON.stringify(metadata));
    await writeFile(archivePath,contents);
    await assert.rejects(signReleaseManifest({manifestPath,signaturePath,privateKeyPem:""}), /required/);
    await signReleaseManifest({manifestPath,signaturePath,privateKeyPem});
    const args={manifestPath,signaturePath,archivePath,publicKeyPem,trustedPublicKeySpkiSha256};
    const identity=await verifyReleaseFiles(args);
    assert.equal(identity.tag,"v1.2.3");
    await assert.rejects(verifyReleaseFiles({...args,trustedPublicKeySpkiSha256:"0".repeat(64)}),/not pinned/);
    await writeFile(archivePath,"tampered");
    await assert.rejects(verifyReleaseFiles(args),/archive mismatch/);
  } finally {await rm(root,{recursive:true,force:true});}
});
