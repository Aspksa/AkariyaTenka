import type { Clock } from "@akariya/core";
import {
  AssistantRuntime,
  ToolExecutor,
  ToolRegistry,
  UnavailableAssistantProvider,
  OpenAICompatibleProvider,
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
  provider: AssistantProvider = process.env.AKARIYA_CLOUDRU_API_KEY
    ? new OpenAICompatibleProvider(
        process.env.AKARIYA_CLOUDRU_API_KEY,
        process.env.AKARIYA_CLOUDRU_MODEL || "ai-sage/GigaChat3-10B-A1.8B",
        "https://foundation-models.api.cloud.ru/v1/chat/completions"
      )
    : process.env.AKARIYA_AI_API_KEY && process.env.AKARIYA_AI_MODEL
      ? new OpenAICompatibleProvider(process.env.AKARIYA_AI_API_KEY, process.env.AKARIYA_AI_MODEL)
      : new UnavailableAssistantProvider()
) {
  let activeProvider = provider;
  const mutableProvider: AssistantProvider = {complete: (request, options) => activeProvider.complete(request,options)};
  const tools = new ToolRegistry();
  const executor = new ToolExecutor(tools, policy, approvals, audit, clock);
  registerReadOnlyTools(tools, { clock, memory: state });
  const runtime = new AssistantRuntime(
    mutableProvider,
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
  return { tools, executor, runtime, provider: mutableProvider, setProvider(next:AssistantProvider) {activeProvider = next;} };
}
