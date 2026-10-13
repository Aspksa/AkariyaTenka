import type { Capability } from "./capabilities.js";

export type AuditDecision = "requested" | "approved" | "denied" | "expired" | "executed" | "failed";

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly actor: string;
  readonly operation: string;
  readonly capabilities: readonly Capability[];
  readonly decision: AuditDecision;
  readonly result?: "success" | "failure";
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AuditSink {
  emit(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];
  async emit(event: AuditEvent): Promise<void> { this.events.push(structuredClone(event)); }
  list(): readonly AuditEvent[] { return this.events.map((event) => structuredClone(event)); }
}
