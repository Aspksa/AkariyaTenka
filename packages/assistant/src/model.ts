import { z } from "zod";

export const assistantRoleSchema = z.enum(["user", "assistant", "tool"]);
export type AssistantRole = z.infer<typeof assistantRoleSchema>;

export const assistantToolCallSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/u),
  arguments: z.unknown()
}).strict();
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>;

export const providerUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  costMicros: z.number().int().nonnegative().optional()
}).strict();
export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export const providerResponseSchema = z.object({
  text: z.string().max(200_000).optional(),
  toolCalls: z.array(assistantToolCallSchema).max(8).default([]),
  usage: providerUsageSchema.optional(),
  finishReason: z.enum(["stop", "tool_calls", "length", "cancelled"]).optional()
}).strict().superRefine((value, context) => {
  if ((value.text ?? "").length === 0 && value.toolCalls.length === 0) {
    context.addIssue({ code: "custom", message: "Provider response must contain text or tool calls" });
  }
});
export type ProviderResponse = z.infer<typeof providerResponseSchema>;

export interface ProviderMessage {
  readonly role: AssistantRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface ProviderToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface ProviderMemorySnippet {
  readonly id: string;
  readonly text: string;
  readonly sourceKind: string;
  readonly updatedAt: string;
}

export interface ProviderRequest {
  readonly sessionId: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly ProviderToolDescriptor[];
  readonly memories: readonly ProviderMemorySnippet[];
}

export interface AssistantProvider {
  complete(request: ProviderRequest, options?: { readonly signal?: AbortSignal }): Promise<unknown>;
}

export type ProviderErrorCategory =
  | "cancelled"
  | "timeout"
  | "rate_limit"
  | "authentication"
  | "invalid_response"
  | "unavailable";

export class AssistantProviderError extends Error {
  constructor(
    readonly category: ProviderErrorCategory,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "AssistantProviderError";
  }
}

export class ScriptedAssistantProvider implements AssistantProvider {
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  async complete(request: ProviderRequest, options?: { readonly signal?: AbortSignal }): Promise<unknown> {
    if (options?.signal?.aborted) {
      throw new AssistantProviderError("cancelled", "Assistant request was cancelled", { cause: options.signal.reason });
    }
    this.requests.push(structuredClone(request));
    if (this.responses.length === 0) {
      throw new AssistantProviderError("unavailable", "Scripted provider has no response");
    }
    return this.responses.shift();
  }
}

export class UnavailableAssistantProvider implements AssistantProvider {
  async complete(): Promise<unknown> {
    throw new AssistantProviderError("unavailable", "No assistant model provider is configured");
  }
}
