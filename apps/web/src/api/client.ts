import {
  healthResponseSchema,
  performanceResponseSchema,
  type HealthResponse,
  type PerformanceResponse
} from "@akariya/contracts";
import { RequestCache } from "./request-cache.js";

const cache = new RequestCache();

async function jsonUnknown(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  return value;
}

async function loadHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    headers: { accept: "application/json" }
  });
  const body = await jsonUnknown(response);
  if (!response.ok) throw new Error("Health request failed with HTTP " + response.status);
  return healthResponseSchema.parse(body);
}

async function loadPerformance(): Promise<PerformanceResponse> {
  const response = await fetch("/api/performance", {
    headers: { accept: "application/json" }
  });
  const body = await jsonUnknown(response);
  if (!response.ok) throw new Error("Performance request failed with HTTP " + response.status);
  return performanceResponseSchema.parse(body);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return cache.get("health", 500, loadHealth, signal);
}

export function getPerformance(signal?: AbortSignal): Promise<PerformanceResponse> {
  return cache.get("performance", 250, loadPerformance, signal);
}
