import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalReleasePayload } from "./release-trust.mjs";
import { discoverSignedUpdate, downloadAndPrepareSignedUpdate } from "./signed-update.mjs";

const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const publicKeyPem=publicKey.export({format:"pem",type:"spki"});
const trustedPublicKeySpkiSha256=createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
const manifest={schemaVersion:1,repository:"Aspksa/AkariyaTenka",tag:"v1.2.3",sourceSha:"a".repeat(40),archiveSha256:"b".repeat(64),archiveSize:1234};
const prefix="https://github.com/Aspksa/AkariyaTenka/releases/download/v1.2.3/";
function fixture({tag="v1.2.3",tamper=false,missing=false}={}) {
 const assets=["AkariyaTenka.zip","AkariyaTenka.zip.sha256","AkariyaTenka.release.json",...(missing ? [] : ["AkariyaTenka.release.sig"])].map(name=>({name,browser_download_url:prefix+name,size:name==="AkariyaTenka.zip"?1234:123}));
 const signed=sign(null,canonicalReleasePayload(manifest),privateKey).toString("base64")+"\n";
 return async url=>{
  if(String(url).endsWith("/releases/latest")) return new Response(JSON.stringify({tag_name:tag,draft:false,prerelease:false,assets}));
  if(String(url).endsWith(".release.json")) return new Response(JSON.stringify(tamper?{...manifest,archiveSize:12}:manifest));
  if(String(url).endsWith(".release.sig")) return new Response(signed);
  throw Error("unexpected URL");
 };
}
test("signed discovery accepts independently pinned publisher",async()=>{
 const verified=await discoverSignedUpdate({publicKeyPem,trustedPublicKeySpkiSha256,fetchImpl:fixture()});
 assert.equal(verified.sha256,manifest.archiveSha256);
 assert.equal(verified.sourceSha,manifest.sourceSha);
});
test("fails closed without trust anchor or with wrong fingerprint",async()=>{
 await assert.rejects(discoverSignedUpdate({fetchImpl:fixture()}),/not configured/);
 await assert.rejects(discoverSignedUpdate({publicKeyPem,trustedPublicKeySpkiSha256:"0".repeat(64),fetchImpl:fixture()}),/not pinned/);
});
test("rejects modified metadata and tag conflicts",async()=>{
 const params={publicKeyPem,trustedPublicKeySpkiSha256};
 await assert.rejects(discoverSignedUpdate({...params,fetchImpl:fixture({tamper:true})}),/verification failed/);
 await assert.rejects(discoverSignedUpdate({...params,fetchImpl:fixture({tag:"v1.2.4"})}),/tag differs/);
 await assert.rejects(discoverSignedUpdate({...params,fetchImpl:fixture({missing:true})}),/Missing or duplicate/);
});
test("download and staging never start before signature verification",async()=>{
 await assert.rejects(downloadAndPrepareSignedUpdate({
  root:"/not/used",updatesDir:"/not/used",publicKeyPem,
  trustedPublicKeySpkiSha256:"0".repeat(64),fetchImpl:fixture()
 }),/not pinned/);
});
