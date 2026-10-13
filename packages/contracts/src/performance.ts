import { z } from "zod";
import { correlationIdSchema } from "./common.js";

const distributionSchema = z.object({
  count: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative(),
  maxMs: z.number().nonnegative()
});

export const performanceResponseSchema = z.object({
  timestamp: z.string().datetime(),
  correlationId: correlationIdSchema,
  uptimeMs: z.number().nonnegative(),
  memory: z.object({
    rssBytes: z.number().int().nonnegative(),
    heapUsedBytes: z.number().int().nonnegative(),
    heapTotalBytes: z.number().int().nonnegative()
  }),
  eventLoop: z.object({
    meanMs: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    maxMs: z.number().nonnegative()
  }),
  metrics: z.record(z.string(), distributionSchema)
});

export type PerformanceResponse = z.infer<typeof performanceResponseSchema>;
