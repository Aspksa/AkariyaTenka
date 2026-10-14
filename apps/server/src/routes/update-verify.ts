import { createHash, createPublicKey, verify } from "node:crypto";

export interface PublisherTrust {
  readonly publicKeyPem: string;
  readonly spkiSha256: string;
}

// Provision only in a separately trusted application distribution. NEVER fetch this from Releases,
// accept it from a browser request, or load it from a mutable downloaded update archive.
export const PINNED_PUBLISHER_TRUST: PublisherTrust | null = null;

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const STABLE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASES = "https://api.github.com/repos/Aspksa/AkariyaTenka/releases/latest";

async function boundedResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error("Release endpoint unavailable");
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) throw new Error("Oversized release asset");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Oversized release asset");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function validateAsset(release: Record<string, unknown>, name: string): string {
  if (!Array.isArray(release.assets)) throw new Error("Invalid assets");
  const assets = release.assets.filter((value: unknown) =>
    !!value && typeof value === "object" && (value as Record<string, unknown>).name === name);
  if (assets.length !== 1) throw new Error("Missing or duplicate signed asset");
  const asset = assets[0] as Record<string, unknown>;
  if (typeof asset.browser_download_url !== "string") throw new Error("Missing signed asset URL");
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com" ||
      url.username || url.password || !url.pathname.startsWith("/Aspksa/AkariyaTenka/releases/download/")) {
    throw new Error("Untrusted signed asset URL");
  }
  return url.toString();
}

export function verifyPublisherManifest(meta: unknown, signatureBase64: string, trust: PublisherTrust) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("Invalid signed metadata");
  const m = meta as Record<string, unknown>;
  const keys = ["schemaVersion", "repository", "tag", "sourceSha", "archiveSha256", "archiveSize"];
  if (Object.keys(m).sort().join("|") !== [...keys].sort().join("|") ||
      m.schemaVersion !== 1 || m.repository !== "Aspksa/AkariyaTenka" ||
      typeof m.tag !== "string" || !STABLE.test(m.tag) ||
      typeof m.sourceSha !== "string" || !SHA40.test(m.sourceSha) ||
      typeof m.archiveSha256 !== "string" || !SHA64.test(m.archiveSha256) ||
      !Number.isSafeInteger(m.archiveSize) || (m.archiveSize as number) <= 0 ||
      (m.archiveSize as number) > 256 * 1024 * 1024) throw new Error("Invalid signed metadata");
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64.trim())) throw new Error("Invalid signature encoding");
  const key = createPublicKey(trust.publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid publisher key type");
  const actualFingerprint = createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
  if (!SHA64.test(trust.spkiSha256) || actualFingerprint !== trust.spkiSha256) throw new Error("Publisher key is not pinned");
  const message = Buffer.from(["akariya-release-v1",m.repository,m.tag,m.sourceSha,m.archiveSha256,String(m.archiveSize),""].join("\n"));
  if (!verify(null, message, key, Buffer.from(signatureBase64.trim(),"base64"))) throw new Error("Publisher signature invalid");
  return { tag:m.tag, sourceSha:m.sourceSha, archiveSha256:m.archiveSha256, archiveSize:m.archiveSize };
}

export function createVerifiedUpdateRoute(trust: PublisherTrust | null = PINNED_PUBLISHER_TRUST, fetchImpl: typeof fetch = fetch) {
  return async (): Promise<string> => {
    if (!trust) return JSON.stringify({
      verified:false, latestTag:null, installationEnabled:false, status:"not_configured",
      message:"Доверенный ключ издателя не закреплён. Проверка подписи и установка недоступны."
    });
    try {
      const fetchOptions: RequestInit = {redirect:"error",signal:AbortSignal.timeout(10000),
        headers:{"Accept":"application/vnd.github+json","User-Agent":"AkariyaTenka-SignedRelease"}};
      const response = await fetchImpl(RELEASES,fetchOptions);
      const release = JSON.parse((await boundedResponse(response,256*1024)).toString("utf8")) as Record<string, unknown>;
      if (release.draft !== false || release.prerelease !== false ||
          typeof release.tag_name !== "string" || !STABLE.test(release.tag_name)) throw new Error("Invalid stable release");
      const manifestUrl = validateAsset(release,"AkariyaTenka.release.json");
      const signatureUrl = validateAsset(release,"AkariyaTenka.release.sig");
      const [manifestResponse, signatureResponse] = await Promise.all([
        fetchImpl(manifestUrl,fetchOptions),fetchImpl(signatureUrl,fetchOptions)
      ]);
      const [manifestBytes,signatureBytes] = await Promise.all([
        boundedResponse(manifestResponse,8192),boundedResponse(signatureResponse,256)
      ]);
      const checked = verifyPublisherManifest(JSON.parse(manifestBytes.toString("utf8")),
        signatureBytes.toString("utf8"),trust);
      if (checked.tag !== release.tag_name) throw new Error("Release tag mismatch");
      return JSON.stringify({verified:true,latestTag:checked.tag,
        installationEnabled:false,status:"verified",
        message:"Цифровая подпись релиза подтверждена. Установка пока отключена."});
    } catch {
      return JSON.stringify({verified:false,latestTag:null,installationEnabled:false,
        status:"failed",message:"Не удалось подтвердить цифровую подпись релиза. Установка запрещена."});
    }
  };
}
