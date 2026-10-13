import type { RequestContext } from "@akariya/core";
import type { ApprovalGate, AuditSink, Capability, Risk, SecurityPolicy } from "@akariya/security";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly capabilities: readonly Capability[];
  readonly risk: Risk;
  execute(input: TInput, context: RequestContext): Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): () => void {
    if (!/^[a-zA-Z0-9_.-]{1,96}$/u.test(tool.name)) throw new Error("Invalid tool name: " + tool.name);
    if (this.tools.has(tool.name)) throw new Error("Duplicate tool: " + tool.name);
    this.tools.set(tool.name, tool);
    return () => { this.tools.delete(tool.name); };
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
  list(): readonly ToolDefinition[] { return [...this.tools.values()]; }
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
    private readonly audit: AuditSink
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
      const value = await tool.execute(parsed.data, context);
      await this.audit.emit({
        id: randomUUID(), timestamp: new Date().toISOString(), correlationId: context.correlationId,
        actor: context.actor, operation: tool.name, capabilities: tool.capabilities, decision: "executed", result: "success"
      });
      return { status: "completed", value };
    } catch (error) {
      await this.audit.emit({
        id: randomUUID(), timestamp: new Date().toISOString(), correlationId: context.correlationId,
        actor: context.actor, operation: tool.name, capabilities: tool.capabilities, decision: "failed", result: "failure",
        details: { error: error instanceof Error ? error.message : String(error) }
      });
      throw error;
    }
  }
}
