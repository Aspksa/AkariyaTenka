import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { sealProjectSecret, unsealProjectSecret } from "./portable-key-vault.mjs";

const scriptRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_NAME = "keys/public/publisher-public.pem";
const FINGERPRINT_NAME = "keys/public/publisher-spki-sha256.txt";
const PRIVATE_NAME = "keys/private/signing-vault.enc";

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function importPublisherKey(root, externalDirectory, passphrase) {
  if (!path.isAbsolute(externalDirectory) || !path.isAbsolute(root)) throw Error("Absolute paths required");
  const privateSource = path.join(externalDirectory, "publisher-private.pem");
  const publicSource = path.join(externalDirectory, "publisher-public.pem");
  const fingerprintSource = path.join(externalDirectory, "publisher-spki-sha256.txt");
  const [privateBytes, publicBytes, fingerprintBytes] = await Promise.all([
    readFile(privateSource), readFile(publicSource), readFile(fingerprintSource)
  ]);
  const privateKey = createPrivateKey(privateBytes);
  const publicKey = createPublicKey(publicBytes);
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519")
    throw Error("Expected Ed25519 keys");
  const fingerprint = createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
  if (fingerprintBytes.toString("utf8").trim() !== fingerprint)
    throw Error("Public fingerprint mismatch");
  const challenge = Buffer.from("akariya-project-key-import-v1");
  if (!verify(null, challenge, publicKey, sign(null, challenge, privateKey)))
    throw Error("The public and private keys do not form a pair");
  const targets = [PUBLIC_NAME, FINGERPRINT_NAME, PRIVATE_NAME].map(name => path.join(root, name));
  if ((await Promise.all(targets.map(exists))).some(Boolean))
    throw Error("Project already has publisher key material; refusing to overwrite");
  const publicDir=path.dirname(targets[0]),privateDir=path.dirname(targets[2]);
  await mkdir(publicDir,{recursive:true});
  await mkdir(privateDir,{recursive:true,mode:0o700});
  try {
    await sealProjectSecret(root, privateBytes, passphrase);
    const unsealed = await unsealProjectSecret(root,passphrase);
    const recovered = createPrivateKey(unsealed);
    if (!verify(null,challenge,publicKey,sign(null,challenge,recovered)))
      throw Error("Encrypted key verification failed");
    await writeFile(targets[0],publicBytes,{flag:"wx",mode:0o644});
    await writeFile(targets[1],fingerprint+"\n",{flag:"wx",mode:0o644});
  } catch (error) {
    // Only remove the newly created vault. Never delete pre-existing key files.
    if (!(await exists(targets[0])) && !(await exists(targets[1]))) await rm(targets[2],{force:true});
    throw error;
  }
  return {fingerprint,publicKey:PUBLIC_NAME,privateVault:PRIVATE_NAME};
}
async function askHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Interactive terminal required");
  const rl=createInterface({input:process.stdin,output:process.stdout,terminal:true});
  const original=rl._writeToOutput.bind(rl);
  let hidden=false;
  rl._writeToOutput=function(value){if(!hidden)original(value);};
  try {
    process.stdout.write(question);
    hidden=true;
    const answer=await new Promise(resolve=>rl.question("",resolve));
    hidden=false;
    process.stdout.write("\n");
    return answer;
  } finally {rl.close();}
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) {
  const [directory]=process.argv.slice(2);
  if (!directory || process.argv.length !== 3) {
    console.error("Usage: node scripts/import-publisher-key.mjs <absolute-external-key-folder>");
    process.exitCode=2;
  } else {
    try {
      const a=await askHidden("Create vault passphrase (minimum 8 chars): ");
      const b=await askHidden("Repeat vault passphrase: ");
      if (a !== b) throw Error("Passphrases do not match");
      const result=await importPublisherKey(scriptRoot,directory,a);
      console.log("Publisher key securely imported into project.");
      console.log("Public key: "+result.publicKey);
      console.log("Encrypted private key: "+result.privateVault);
      console.log("SPKI SHA-256: "+result.fingerprint);
      console.log("Keep the original key files outside Git until an independent encrypted backup is verified.");
    } catch(error) {console.error(error.message);process.exitCode=1;}
  }
}
