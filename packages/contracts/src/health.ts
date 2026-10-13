import { z } from "zod";
import { correlationIdSchema } from "./common.js";

export const moduleHealthSchema = z.object({
  state: z.enum(["started", "degraded", "failed"]),
  lastSuccess: z.string().datetime().optional(),
  lastError: z.string().optional(),
  recoverable: z.boolean()
});

export const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "failed"]),
  timestamp: z.string().datetime(),
  correlationId: correlationIdSchema,
  modules: z.record(z.string(), moduleHealthSchema)
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
