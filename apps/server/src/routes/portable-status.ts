import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function createPortableStatusRoute(root: string): Promise<string> {
  const marker = path.join(root, ".akariya-installation.json");
  let installationId: string | null = null;
  try {
    const record: unknown = JSON.parse(await readFile(marker, "utf8"));
    if (record && typeof record === "object" && "installationId" in record &&
        typeof record.installationId === "string" &&
        /^[0-9a-f-]{36}$/.test(record.installationId)) installationId = record.installationId;
  } catch { /* installation not initialized */ }
  const exists = async (p: string) => access(path.join(root,p)).then(()=>true).catch(()=>false);
  const [baseline, runtime, sync, publicKey, privateVault] = await Promise.all([
    exists(".portable-state/snapshot.json"),
    exists(".portable-state/runtime.lock"),
    exists(".portable-state/sync.lock"),
    exists("keys/public/publisher-public.pem"),
    exists("keys/private/signing-vault.enc")
  ]);
  let lastTransfer: unknown = null;
  try {
    const raw = await readFile(path.join(root, ".portable-state", "last-transfer.json"), "utf8");
    if (raw.length < 16384) lastTransfer = JSON.parse(raw);
  } catch { /* no previous transfer result */ }
  return JSON.stringify({projectRoot:path.resolve(root),installationId, baseline, runtimeLocked:runtime, syncLocked:sync, lastTransfer,
    publicKeyPresent:publicKey, encryptedVaultPresent:privateVault,
    requiresShutdownForTransfer:true, automaticMergeAvailable:false});
}
