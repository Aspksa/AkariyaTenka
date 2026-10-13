import { randomUUID } from "node:crypto";
import {
  AppError,
  SystemClock,
  type Clock,
  type RequestContext
} from "@akariya/core";
import {
  AssistantProviderError,
  providerResponseSchema,
  type AssistantProvider,
  type ProviderUsage
} from "./model.js";
import {
  conversationIdSchema,
  type ConversationMessage,
  type ConversationSession,
  type ConversationStore
} from "./conversation.js";
import { memoryScopeSchema, type MemoryStore } from "./memory.js";
import { ToolExecutor, ToolRegistry } from "./tools.js";

export interface AssistantTurnInput {
  readonly text: string;
  readonly sessionId?: string;
}

export interface AssistantUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
}

export type AssistantTurnResult =
  | {
      readonly status: "completed";
      readonly sessionId: string;
      readonly turnId: string;
      readonly text: string;
      readonly usage: AssistantUsage;
      readonly replayed: boolean;
    }
  | {
      readonly status: "approval_required";
      readonly sessionId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly approvalId: string;
      readonly expiresAt: number;
      readonly usage: AssistantUsage;
    };

export interface AssistantRuntimeOptions {
  readonly maxToolRounds?: number;
  readonly historyLimit?: number;
  readonly memoryLimit?: number;
  readonly memoryScope?: string;
}

interface NormalizedOptions {
  readonly maxToolRounds: number;
  readonly historyLimit: number;
  readonly memoryLimit: number;
  readonly memoryScope: string;
}

function usageZero(): AssistantUsage {
  return { inputTokens: 0, outputTokens: 0, costMicros: 0 };
}

function addUsage(total: AssistantUsage, value: ProviderUsage | undefined): AssistantUsage {
  if (value === undefined) return total;
  return {
    inputTokens: total.inputTokens + value.inputTokens,
    outputTokens: total.outputTokens + value.outputTokens,
    costMicros: total.costMicros + (value.costMicros ?? 0)
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AssistantProviderError("cancelled", "Assistant turn was cancelled", { cause: signal.reason });
  }
}

function jsonToolResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "null";
  if (serialized.length > 200_000) {
    throw new AppError({ code: "INTEGRITY", message: "Tool result is too large for the assistant context" });
  }
  return serialized;
}

export class AssistantRuntime {
  private readonly options: NormalizedOptions;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly provider: AssistantProvider,
    private readonly registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly conversations: ConversationStore,
    private readonly memory: MemoryStore,
    private readonly clock: Clock = new SystemClock(),
    options: AssistantRuntimeOptions = {}
  ) {
    const maxToolRounds = options.maxToolRounds ?? 4;
    const historyLimit = options.historyLimit ?? 64;
    const memoryLimit = options.memoryLimit ?? 8;
    const memoryScope = memoryScopeSchema.parse(options.memoryScope ?? "assistant");

    if (!Number.isSafeInteger(maxToolRounds) || maxToolRounds < 0 || maxToolRounds > 8) {
      throw new Error("maxToolRounds must be an integer between 0 and 8");
    }
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 256) {
      throw new Error("historyLimit must be an integer between 1 and 256");
    }
    if (!Number.isSafeInteger(memoryLimit) || memoryLimit < 0 || memoryLimit > 32) {
      throw new Error("memoryLimit must be an integer between 0 and 32");
    }

    this.options = { maxToolRounds, historyLimit, memoryLimit, memoryScope };
  }

  async runTurn(
    input: AssistantTurnInput,
    context: RequestContext,
    signal?: AbortSignal
  ): Promise<AssistantTurnResult> {
    const text = input.text.trim();
    if (text.length === 0 || text.length > 100_000) {
      throw new AppError({
        code: "VALIDATION",
        message: "Assistant input text must contain between 1 and 100000 characters",
        correlationId: context.correlationId
      });
    }

    throwIfAborted(signal);
    const sessionId = input.sessionId === undefined
      ? randomUUID()
      : conversationIdSchema.parse(input.sessionId);

    return this.serialized(sessionId, async () => {
      let session = await this.conversations.getSession(sessionId);
      if (session === null) {
        if (input.sessionId !== undefined) {
          throw new AppError({
            code: "NOT_FOUND",
            message: "Conversation session not found",
            correlationId: context.correlationId
          });
        }
        const now = this.clock.now().toISOString();
        session = { id: sessionId, createdAt: now, updatedAt: now, version: 1 };
        await this.conversations.createSession(session);
      }

      const turnId = context.idempotencyKey ?? randomUUID();
      const existing = await this.conversations.listTurnMessages(sessionId, turnId);
      if (existing.length > 0) {
        const completed = [...existing].reverse().find(
          (message) => message.role === "assistant" && (message.toolCalls?.length ?? 0) === 0
        );
        if (completed !== undefined) {
          return {
            status: "completed",
            sessionId,
            turnId,
            text: completed.content,
            usage: usageZero(),
            replayed: true
          };
        }
        throw new AppError({
          code: "CONFLICT",
          message: "Assistant turn already exists but is incomplete",
          correlationId: context.correlationId
        });
      }

      await this.appendMessage({
        sessionId,
        turnId,
        role: "user",
        content: text,
        context
      });

      const memories = this.options.memoryLimit === 0
        ? []
        : await this.memory.search({
            scope: this.options.memoryScope,
            query: text,
            limit: this.options.memoryLimit
          });

      let usage = usageZero();

      for (let round = 0; round <= this.options.maxToolRounds; round += 1) {
        throwIfAborted(signal);
        const messages = await this.conversations.listMessages(sessionId, this.options.historyLimit);
        const raw = await this.completeProvider({
          sessionId,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
            ...(message.toolName === undefined ? {} : { toolName: message.toolName })
          })),
          tools: this.registry.describe(),
          memories: memories.map((record) => ({
            id: record.id,
            text: record.text,
            sourceKind: record.source.kind,
            updatedAt: record.updatedAt
          }))
        }, signal);

        const parsed = providerResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new AssistantProviderError(
            "invalid_response",
            "Assistant provider returned invalid structured output",
            { cause: parsed.error }
          );
        }

        usage = addUsage(usage, parsed.data.usage);
        const response = parsed.data;

        if (response.toolCalls.length === 0) {
          const reply = response.text ?? "";
          await this.appendMessage({
            sessionId,
            turnId,
            role: "assistant",
            content: reply,
            context
          });
          return { status: "completed", sessionId, turnId, text: reply, usage, replayed: false };
        }

        if (round >= this.options.maxToolRounds) {
          throw new AppError({
            code: "EXTERNAL_SERVICE",
            message: "Assistant tool loop limit exceeded",
            correlationId: context.correlationId
          });
        }

        await this.appendMessage({
          sessionId,
          turnId,
          role: "assistant",
          content: response.text ?? "",
          toolCalls: response.toolCalls,
          context
        });

        for (const call of response.toolCalls) {
          throwIfAborted(signal);
          const result = await this.executor.execute(call.name, call.arguments, context);

          if (result.status === "approval_required") {
            return {
              status: "approval_required",
              sessionId,
              turnId,
              toolCallId: call.id,
              toolName: call.name,
              approvalId: result.approvalId,
              expiresAt: result.expiresAt,
              usage
            };
          }

          const content = result.status === "completed"
            ? jsonToolResult({ status: "completed", value: result.value })
            : jsonToolResult({ status: "denied", reason: result.reason });

          await this.appendMessage({
            sessionId,
            turnId,
            role: "tool",
            content,
            toolCallId: call.id,
            toolName: call.name,
            context
          });
        }
      }

      throw new AppError({
        code: "INTERNAL",
        message: "Assistant turn ended without a result",
        correlationId: context.correlationId
      });
    });
  }

  private async completeProvider(
    request: Parameters<AssistantProvider["complete"]>[0],
    signal?: AbortSignal
  ): Promise<unknown> {
    try {
      return await this.provider.complete(
        request,
        signal === undefined ? undefined : { signal }
      );
    } catch (error) {
      if (error instanceof AssistantProviderError) throw error;
      if (signal?.aborted) {
        throw new AssistantProviderError("cancelled", "Assistant turn was cancelled", { cause: signal.reason });
      }
      throw new AssistantProviderError("unavailable", "Assistant provider request failed", { cause: error });
    }
  }

  private async appendMessage(input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly role: ConversationMessage["role"];
    readonly content: string;
    readonly context: RequestContext;
    readonly toolCallId?: string;
    readonly toolName?: string;
    readonly toolCalls?: ConversationMessage["toolCalls"];
  }): Promise<void> {
    const message: ConversationMessage = {
      id: randomUUID(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      role: input.role,
      content: input.content,
      createdAt: this.clock.now().toISOString(),
      correlationId: input.context.correlationId,
      ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
      ...(input.toolName === undefined ? {} : { toolName: input.toolName }),
      ...(input.toolCalls === undefined ? {} : { toolCalls: input.toolCalls })
    };
    await this.conversations.appendMessage(message);
  }

  private serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.tails.set(key, tail);

    return previous.then(operation, operation).finally(() => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }
}
