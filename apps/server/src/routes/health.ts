import type { RequestContext } from "@akariya/core";
import { healthResponseSchema } from "@akariya/contracts";
import type { HealthService } from "../services/health-service.js";

export function createHealthRoute(health: HealthService) {
  return async (context: RequestContext): Promise<string> => {
    const snapshot = healthResponseSchema.parse(await health.snapshot(context.correlationId));
    return JSON.stringify(snapshot);
  };
}
