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
