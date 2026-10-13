import { createHash, randomUUID } from "node:crypto";
import type { Clock, RequestContext } from "@akariya/core";
import { SystemClock } from "@akariya/core";
import type { AuditSink } from "./audit.js";
import type { Capability, Risk } from "./capabilities.js";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(record[key])).join(",") + "}";
}

function digestArgs(args: unknown): string {
  return createHash("sha256").update(canonicalize(args)).digest("hex");
}

export interface ApprovalRequest {
  readonly id: string;
  readonly correlationId: string;
  readonly actor: string;
  readonly idempotencyKey?: string;
  readonly operation: string;
  readonly capabilities: readonly Capability[];
  readonly risk: Risk;
  readonly argsDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface PendingApproval {
  readonly request: ApprovalRequest;
  state: "pending" | "approved";
}

export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly audit: AuditSink,
    private readonly ttlMs = 120_000,
    private readonly clock: Clock = new SystemClock()
  ) {}

  async request(
    context: RequestContext,
    operation: string,
    capabilities: readonly Capability[],
    risk: Risk,
    args: unknown
  ): Promise<ApprovalRequest> {
    const createdAt = this.clock.nowMs();
    const request: ApprovalRequest = {
      id: randomUUID(),
      correlationId: context.correlationId,
      actor: context.actor,
      ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
      operation,
      capabilities: [...capabilities],
      risk,
      argsDigest: digestArgs(args),
      createdAt,
      expiresAt: createdAt + this.ttlMs
    };

    await this.audit.emit({
      id: randomUUID(), timestamp: this.clock.now().toISOString(), correlationId: context.correlationId,
      ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
      actor: context.actor, operation, capabilities, decision: "requested"
    });
    this.pending.set(request.id, { request, state: "pending" });
    return structuredClone(request);
  }

  async decide(id: string, approved: boolean): Promise<boolean> {
    const entry = this.pending.get(id);
    if (!entry || entry.state !== "pending") return false;
    if (this.clock.nowMs() >= entry.request.expiresAt) {
      await this.record(entry.request, "expired");
      this.pending.delete(id);
      return false;
    }
    if (!approved) {
      await this.record(entry.request, "denied");
      this.pending.delete(id);
      return true;
    }

    await this.record(entry.request, "approved");
    entry.state = "approved";
    return true;
  }

  async consume(id: string, context: RequestContext, operation: string, capabilities: readonly Capability[], args: unknown): Promise<boolean> {
    const entry = this.pending.get(id);
    if (!entry || entry.state !== "approved") return false;
    this.pending.delete(id);
    const request = entry.request;
    if (this.clock.nowMs() >= request.expiresAt) {
      await this.record(request, "expired");
      return false;
    }
    const sameCapabilities = [...capabilities].sort().join("\0") === [...request.capabilities].sort().join("\0");
    return request.correlationId === context.correlationId
      && request.actor === context.actor
      && request.idempotencyKey === context.idempotencyKey
      && request.operation === operation
      && sameCapabilities
      && request.argsDigest === digestArgs(args);
  }

  list(): readonly ApprovalRequest[] {
    return [...this.pending.values()]
      .filter(({ request }) => this.clock.nowMs() < request.expiresAt)
      .map(({ request }) => structuredClone(request));
  }

  private async record(request: ApprovalRequest, decision: "approved" | "denied" | "expired"): Promise<void> {
    await this.audit.emit({
      id: randomUUID(), timestamp: this.clock.now().toISOString(), correlationId: request.correlationId,
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
      actor: request.actor, operation: request.operation, capabilities: request.capabilities, decision
    });
  }
}
