import { performanceResponseSchema, type PerformanceResponse } from "@akariya/contracts";
import { apiCache } from "./cache.js";

async function loadPerformance(): Promise<PerformanceResponse> {
  const response = await fetch("/api/performance", {
    headers: { accept: "application/json" }
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error("Performance request failed with HTTP " + response.status);
  return performanceResponseSchema.parse(body);
}

export function getPerformance(signal?: AbortSignal): Promise<PerformanceResponse> {
  return apiCache.get("performance", 250, loadPerformance, signal);
}
