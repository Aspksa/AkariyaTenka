import type { RequestContext } from "@akariya/core";
import { performanceResponseSchema } from "@akariya/contracts";
import type { PerformanceMetrics } from "../services/performance-metrics.js";

export function createPerformanceRoute(metrics: PerformanceMetrics) {
  return async (context: RequestContext): Promise<string> => {
    const snapshot = performanceResponseSchema.parse(metrics.snapshot(context.correlationId));
    return JSON.stringify(snapshot);
  };
}
