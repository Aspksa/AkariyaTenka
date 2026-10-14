export interface UpdateStatus {
  currentVersion: string | null;
  publisherConfigured: boolean;
  installationEnabled: boolean;
  pendingRestart: boolean;
  pendingConfirmation: boolean;
  message: string;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const response = await fetch("/api/updates/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to read update status");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid update status");
  const value = data as Record<string, unknown>;
  if (!(value.currentVersion === null || typeof value.currentVersion === "string") ||
      typeof value.publisherConfigured !== "boolean" ||
      typeof value.installationEnabled !== "boolean" ||
      typeof value.pendingRestart !== "boolean" ||
      typeof value.pendingConfirmation !== "boolean" ||
      typeof value.message !== "string") throw new Error("Invalid update status");
  return value as unknown as UpdateStatus;
}

export interface ReleaseCheck {
  currentVersion: string | null;
  latestTag: string | null;
  releaseUrl: string | null;
  signatureVerified: false;
  installationEnabled: false;
  status: "unverified" | "unavailable";
  message: string;
}

export async function checkReleases(): Promise<ReleaseCheck> {
  const response = await fetch("/api/updates/check", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось проверить наличие обновлений.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("Некорректный ответ сервера");
  const data = value as Record<string, unknown>;
  if (!(data.latestTag === null || typeof data.latestTag === "string") ||
      !(data.releaseUrl === null || typeof data.releaseUrl === "string") ||
      data.signatureVerified !== false || data.installationEnabled !== false ||
      typeof data.message !== "string" ||
      !["unverified", "unavailable"].includes(String(data.status))) {
    throw new Error("Некорректный статус обновлений");
  }
  return data as unknown as ReleaseCheck;
}
