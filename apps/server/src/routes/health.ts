import { healthResponseSchema } from "@akariya/contracts";
import type { HealthService } from "../services/health-service.js";

export function createHealthRoute(health: HealthService) {
  return async (correlationId: string): Promise<string> => {
    const snapshot = healthResponseSchema.parse(await health.snapshot(correlationId));
    return JSON.stringify(snapshot);
  };
}
