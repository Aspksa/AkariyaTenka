import { z } from "zod";

export const correlationIdSchema = z.string().min(8).max(128);
export const idempotencyKeySchema = z.string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u, "Idempotency key contains unsupported characters");

export const errorCodeSchema = z.enum(["VALIDATION","NOT_FOUND","CONFLICT","PERMISSION","INTEGRITY","EXTERNAL_SERVICE","RATE_LIMIT","INTERNAL"]);
export const apiErrorSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string().min(1), correlationId: correlationIdSchema })
});
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
