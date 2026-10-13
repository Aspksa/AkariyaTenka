import { healthResponseSchema, type HealthResponse } from "@akariya/contracts";
import { apiCache } from "./cache.js";

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    headers: { accept: "application/json" }
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error("Health request failed with HTTP " + response.status);
  return healthResponseSchema.parse(body);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiCache.get("health", 500, loadHealth, signal);
}
