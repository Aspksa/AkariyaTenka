import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ReleaseCheck {
  readonly currentVersion: string | null;
  readonly latestTag: string | null;
  readonly releaseUrl: string | null;
  readonly signatureVerified: false;
  readonly installationEnabled: false;
  readonly status: "unverified" | "unavailable";
  readonly message: string;
}

const RELEASE_URL = "https://api.github.com/repos/Aspksa/AkariyaTenka/releases/latest";
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RESPONSE = 256 * 1024;

export function createUpdateCheckRoute(root: string, fetchImpl: typeof fetch = fetch) {
  return async (): Promise<string> => {
    const currentVersion = await readFile(path.join(path.resolve(root), ".akariya-version"), "utf8")
      .then((v) => v.trim() || null)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    let latestTag: string | null = null;
    let releaseUrl: string | null = null;
    let status: ReleaseCheck["status"] = "unavailable";
    let message = "Не удалось проверить GitHub Releases.";
    try {
      const response = await fetchImpl(RELEASE_URL, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "AkariyaTenka-UpdateChecker" },
        signal: AbortSignal.timeout(8000),
        redirect: "error"
      });
      if (response.status === 404) {
        message = "Опубликованных релизов пока нет.";
      } else if (!response.ok) {
        message = "GitHub Releases временно недоступен.";
      } else {
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > MAX_RESPONSE) throw new Error("Oversized release metadata");
        if (!response.body) throw new Error("Empty release response");
        const chunks: Uint8Array[] = [];
        let total = 0;
        for await (const chunk of response.body) {
          total += chunk.byteLength;
          if (total > MAX_RESPONSE) throw new Error("Oversized release metadata");
          chunks.push(chunk);
        }
        const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!json || typeof json !== "object") throw new Error("Invalid release metadata");
        const release = json as Record<string, unknown>;
        if (release.draft !== false || release.prerelease !== false ||
            typeof release.tag_name !== "string" || !VERSION_TAG.test(release.tag_name)) {
          throw new Error("Invalid release metadata");
        }
        latestTag = release.tag_name;
        releaseUrl = "https://github.com/Aspksa/AkariyaTenka/releases/tag/" + encodeURIComponent(latestTag);
        status = "unverified";
        message = "Релиз найден, но цифровая подпись издателя здесь ещё не проверена. Установка запрещена.";
      }
    } catch {
      message = "Проверка GitHub не удалась. Установка запрещена.";
    }
    const result: ReleaseCheck = {
      currentVersion, latestTag, releaseUrl, signatureVerified: false,
      installationEnabled: false, status, message
    };
    return JSON.stringify(result);
  };
}
