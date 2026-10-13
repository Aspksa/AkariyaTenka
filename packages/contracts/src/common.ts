import { z } from "zod";

export const correlationIdSchema = z.string().min(8).max(128);
export const errorCodeSchema = z.enum(["VALIDATION","NOT_FOUND","CONFLICT","PERMISSION","INTEGRITY","EXTERNAL_SERVICE","RATE_LIMIT","INTERNAL"]);
export const apiErrorSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string().min(1), correlationId: correlationIdSchema })
});
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
