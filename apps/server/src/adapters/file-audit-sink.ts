import { z } from "zod";
import type { ComponentHealth } from "@akariya/core";
import { JsonlStore } from "@akariya/persistence";
import { capabilities, type AuditEvent, type AuditSink } from "@akariya/security";

const auditSchema: z.ZodType<AuditEvent> = z.object({
  id: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
  idempotencyKey: z.string().optional(),
  actor: z.string(),
  operation: z.string(),
  capabilities: z.array(z.enum(capabilities)),
  decision: z.enum(["requested", "approved", "denied", "expired", "executed", "failed"]),
  result: z.enum(["success", "failure"]).optional(),
  details: z.record(z.string(), z.unknown()).optional()
}).transform((value): AuditEvent => ({
  id: value.id,
  timestamp: value.timestamp,
  correlationId: value.correlationId,
  ...(value.idempotencyKey === undefined ? {} : { idempotencyKey: value.idempotencyKey }),
  actor: value.actor,
  operation: value.operation,
  capabilities: value.capabilities,
  decision: value.decision,
  ...(value.result === undefined ? {} : { result: value.result }),
  ...(value.details === undefined ? {} : { details: value.details })
}));

export class FileAuditSink implements AuditSink {
  private readonly store: JsonlStore<AuditEvent>;

  constructor(filePath: string, maxBytes = 10 * 1024 * 1024, maxArchives = 5) {
    this.store = new JsonlStore(filePath, auditSchema, { maxBytes, maxArchives });
  }

  async emit(event: AuditEvent): Promise<void> { await this.store.append(event); }
  async flush(): Promise<void> { await this.store.flush(); }

  async health(): Promise<ComponentHealth> {
    const probe = await this.store.probe();
    return probe.status === "ok"
      ? { state: "started", recoverable: true }
      : { state: "degraded", recoverable: true, lastError: probe.lastError ?? "Audit storage unavailable" };
  }
}
