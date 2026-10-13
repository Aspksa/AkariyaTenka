import type { Clock } from "@akariya/core";
import { ToolExecutor, ToolRegistry } from "@akariya/assistant";
import type { ApprovalGate, AuditSink, SecurityPolicy } from "@akariya/security";

export function createAssistant(policy: SecurityPolicy, approvals: ApprovalGate, audit: AuditSink, clock: Clock) {
  const tools = new ToolRegistry();
  const executor = new ToolExecutor(tools, policy, approvals, audit, clock);
  return { tools, executor };
}
