import { z } from "zod";
import { JsonlStore } from "@akariya/persistence";
import { capabilities, type AuditEvent, type AuditSink } from "@akariya/security";

const auditSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
  actor: z.string(),
  operation: z.string(),
  capabilities: z.array(z.enum(capabilities)),
  decision: z.enum(["requested", "approved", "denied", "expired", "executed", "failed"]),
  result: z.enum(["success", "failure"]).optional(),
  details: z.record(z.string(), z.unknown()).optional()
}) satisfies z.ZodType<AuditEvent>;

export class FileAuditSink implements AuditSink {
  private readonly store: JsonlStore<AuditEvent>;
  constructor(filePath: string) { this.store = new JsonlStore(filePath, auditSchema); }
  async emit(event: AuditEvent): Promise<void> { await this.store.append(event); }
  async flush(): Promise<void> { await this.store.flush(); }
}
