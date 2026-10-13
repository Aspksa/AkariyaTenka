import { healthResponseSchema, type HealthResponse } from "@akariya/contracts";

async function jsonUnknown(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  return value;
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {})
  });
  const body = await jsonUnknown(response);
  if (!response.ok) throw new Error("Health request failed with HTTP " + response.status);
  return healthResponseSchema.parse(body);
}
