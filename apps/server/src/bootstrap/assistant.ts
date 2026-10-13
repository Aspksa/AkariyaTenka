import type { Clock } from "@akariya/core";
import {
  AssistantRuntime,
  ToolExecutor,
  ToolRegistry,
  UnavailableAssistantProvider,
  registerReadOnlyTools,
  type AssistantProvider,
  type ConversationStore,
  type MemoryStore
} from "@akariya/assistant";
import type { ApprovalGate, AuditSink, SecurityPolicy } from "@akariya/security";

type AssistantState = ConversationStore & MemoryStore;

export function createAssistant(
  policy: SecurityPolicy,
  approvals: ApprovalGate,
  audit: AuditSink,
  clock: Clock,
  state: AssistantState,
  provider: AssistantProvider = new UnavailableAssistantProvider()
) {
  const tools = new ToolRegistry();
  const executor = new ToolExecutor(tools, policy, approvals, audit, clock);
  registerReadOnlyTools(tools, { clock, memory: state });
  const runtime = new AssistantRuntime(
    provider,
    tools,
    executor,
    state,
    state,
    clock,
    {
      maxToolRounds: 4,
      historyLimit: 64,
      memoryLimit: 8,
      memoryScope: "assistant"
    }
  );
  return { tools, executor, runtime, provider };
}
