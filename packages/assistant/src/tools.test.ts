import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ApprovalGate, DefaultSecurityPolicy, InMemoryAuditSink } from "@akariya/security";
import { ToolExecutor, ToolRegistry } from "./index.js";

describe("tool execution", () => {
  it("validates unknown input before execution", async () => {
    const audit = new InMemoryAuditSink();
    const registry = new ToolRegistry();
    registry.register({
      name: "read.echo", description: "echo", inputSchema: z.object({ text: z.string() }), outputSchema: z.string(),
      capabilities: ["read_local"], risk: "read", execute: async (input) => input.text
    });
    const executor = new ToolExecutor(registry, new DefaultSecurityPolicy(), new ApprovalGate(audit), audit);
    const result = await executor.execute("read.echo", { text: 4 }, { correlationId: "corr-12345678", actor: "user" });
    expect(result.status).toBe("denied");
  });

  it("validates tool output before returning it", async () => {
    const audit = new InMemoryAuditSink();
    const registry = new ToolRegistry();
    registry.register({
      name: "read.invalid-output",
      description: "invalid output fixture",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      capabilities: ["read_local"],
      risk: "read",
      execute: async () => ({ ok: false as const })
    });
    const executor = new ToolExecutor(registry, new DefaultSecurityPolicy(), new ApprovalGate(audit), audit);
    await expect(executor.execute(
      "read.invalid-output",
      {},
      { correlationId: "corr-output12", actor: "user" }
    )).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(audit.list().at(-1)).toMatchObject({
      operation: "read.invalid-output",
      decision: "failed",
      result: "failure",
      details: { errorType: "AppError" }
    });
  });

  it("requires approval for side effects", async () => {
    const audit = new InMemoryAuditSink();
    const approvals = new ApprovalGate(audit);
    const registry = new ToolRegistry();
    registry.register({
      name: "write.echo", description: "write", inputSchema: z.object({ text: z.string() }), outputSchema: z.string(),
      capabilities: ["write_local"], risk: "write", execute: async (input) => input.text
    });
    const executor = new ToolExecutor(registry, new DefaultSecurityPolicy(), approvals, audit);
    const context = { correlationId: "corr-abcdefgh", actor: "user" };
    const first = await executor.execute("write.echo", { text: "ok" }, context);
    expect(first.status).toBe("approval_required");
    if (first.status !== "approval_required") return;
    await approvals.decide(first.approvalId, true);
    const second = await executor.execute("write.echo", { text: "ok" }, context, first.approvalId);
    expect(second).toEqual({ status: "completed", value: "ok" });
  });
});
