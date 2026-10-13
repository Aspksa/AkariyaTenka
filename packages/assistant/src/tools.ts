import { AppError, SystemClock, type Clock, type RequestContext } from "@akariya/core";
import type { ApprovalGate, AuditSink, Capability, Risk, SecurityPolicy } from "@akariya/security";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly outputSchema: ZodType<TOutput>;
  readonly capabilities: readonly Capability[];
  readonly risk: Risk;
  execute(input: TInput, context: RequestContext): Promise<TOutput>;
}

interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<unknown>;
  readonly outputSchema: ZodType<unknown>;
  readonly capabilities: readonly Capability[];
  readonly risk: Risk;
  execute(input: unknown, context: RequestContext): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): () => void {
    if (!/^[a-zA-Z0-9_.-]{1,96}$/u.test(tool.name)) throw new Error("Invalid tool name: " + tool.name);
    if (this.tools.has(tool.name)) throw new Error("Duplicate tool: " + tool.name);
    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as ZodType<unknown>,
      outputSchema: tool.outputSchema as ZodType<unknown>,
      capabilities: tool.capabilities,
      risk: tool.risk,
      execute: (input, context) => tool.execute(input as TInput, context)
    });
    return () => { this.tools.delete(tool.name); };
  }

  get(name: string): RegisteredTool | undefined { return this.tools.get(name); }
  list(): readonly RegisteredTool[] { return [...this.tools.values()]; }
}

export type ToolExecutionResult =
  | { readonly status: "completed"; readonly value: unknown }
  | { readonly status: "approval_required"; readonly approvalId: string; readonly expiresAt: number }
  | { readonly status: "denied"; readonly reason: string };

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: SecurityPolicy,
    private readonly approvals: ApprovalGate,
    private readonly audit: AuditSink,
    private readonly clock: Clock = new SystemClock()
  ) {}

  async execute(name: string, rawInput: unknown, context: RequestContext, approvalId?: string): Promise<ToolExecutionResult> {
    const tool = this.registry.get(name);
    if (!tool) return { status: "denied", reason: "Unknown tool" };
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) return { status: "denied", reason: "Tool arguments failed runtime validation" };

    const decision = this.policy.evaluate({ capabilities: tool.capabilities, risk: tool.risk });
    if (!decision.allowed) return { status: "denied", reason: decision.reason };

    if (decision.approvalRequired) {
      if (!approvalId) {
        const approval = await this.approvals.request(context, tool.name, tool.capabilities, tool.risk, parsed.data);
        return { status: "approval_required", approvalId: approval.id, expiresAt: approval.expiresAt };
      }
      const consumed = await this.approvals.consume(approvalId, context, tool.name, tool.capabilities, parsed.data);
      if (!consumed) return { status: "denied", reason: "Approval is missing, expired, reused or does not match the action" };
    }

    try {
      const rawOutput = await tool.execute(parsed.data, context);
      const output = tool.outputSchema.safeParse(rawOutput);
      if (!output.success) {
        throw new AppError({
          code: "INTEGRITY",
          message: "Tool output failed runtime validation",
          correlationId: context.correlationId
        });
      }
      await this.audit.emit({
        id: randomUUID(), timestamp: this.clock.now().toISOString(), correlationId: context.correlationId,
        ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
        actor: context.actor, operation: tool.name, capabilities: tool.capabilities, decision: "executed", result: "success"
      });
      return { status: "completed", value: output.data };
    } catch (error) {
      await this.audit.emit({
        id: randomUUID(), timestamp: this.clock.now().toISOString(), correlationId: context.correlationId,
        ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey }),
        actor: context.actor, operation: tool.name, capabilities: tool.capabilities, decision: "failed", result: "failure",
        details: { errorType: error instanceof Error ? error.name : "UnknownError" }
      });
      throw error;
    }
  }
}
