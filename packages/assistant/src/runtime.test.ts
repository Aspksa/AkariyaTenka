import { describe, expect, it } from "vitest";
import { ApprovalGate, DefaultSecurityPolicy, InMemoryAuditSink } from "@akariya/security";
import {
  AssistantProviderError,
  AssistantRuntime,
  InMemoryConversationStore,
  InMemoryMemoryStore,
  ScriptedAssistantProvider,
  ToolExecutor,
  ToolRegistry,
  registerReadOnlyTools
} from "./index.js";

const clock = {
  now: () => new Date("2026-10-14T01:02:03.000Z"),
  nowMs: () => Date.parse("2026-10-14T01:02:03.000Z")
};

function fixture(responses: unknown[]) {
  const audit = new InMemoryAuditSink();
  const conversations = new InMemoryConversationStore();
  const memory = new InMemoryMemoryStore();
  const registry = new ToolRegistry();
  registerReadOnlyTools(registry, { clock, memory });
  const executor = new ToolExecutor(
    registry,
    new DefaultSecurityPolicy(),
    new ApprovalGate(audit, 120_000, clock),
    audit,
    clock
  );
  const provider = new ScriptedAssistantProvider(responses);
  const runtime = new AssistantRuntime(
    provider,
    registry,
    executor,
    conversations,
    memory,
    clock,
    { maxToolRounds: 2, historyLimit: 32, memoryLimit: 4 }
  );
  return { runtime, provider, conversations, memory, audit, registry };
}

describe("assistant runtime", () => {
  it("persists a validated conversation turn and does not auto-write memory", async () => {
    const { runtime, conversations, memory } = fixture([
      { text: "Hello from Akariya.", toolCalls: [], usage: { inputTokens: 4, outputTokens: 5 } }
    ]);

    const result = await runtime.runTurn(
      { text: "Hello" },
      { correlationId: "corr-runtime-0001", actor: "user", idempotencyKey: "turn-runtime-0001" }
    );

    expect(result).toMatchObject({
      status: "completed",
      text: "Hello from Akariya.",
      replayed: false,
      usage: { inputTokens: 4, outputTokens: 5, costMicros: 0 }
    });
    if (result.status !== "completed") return;

    const messages = await conversations.listMessages(result.sessionId);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(await memory.listRecent("assistant")).toEqual([]);
  });

  it("executes a read-only tool through ToolExecutor and continues the provider loop", async () => {
    const { runtime, provider, memory, audit } = fixture([
      {
        text: "",
        toolCalls: [{ id: "call-time-1", name: "system.time", arguments: {} }],
        usage: { inputTokens: 2, outputTokens: 1 }
      },
      {
        text: "The runtime clock is available.",
        toolCalls: [],
        usage: { inputTokens: 3, outputTokens: 4 }
      }
    ]);

    await memory.put({
      id: "memory-00000001",
      scope: "assistant",
      text: "Remember the runtime clock.",
      source: { kind: "user", reference: "fixture" },
      tags: ["runtime"],
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z"
    });

    const result = await runtime.runTurn(
      { text: "What time is the runtime clock?" },
      { correlationId: "corr-runtime-0002", actor: "user" }
    );

    expect(result).toMatchObject({
      status: "completed",
      text: "The runtime clock is available.",
      usage: { inputTokens: 5, outputTokens: 5, costMicros: 0 }
    });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.memories[0]?.id).toBe("memory-00000001");
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call-time-1",
      toolName: "system.time"
    });
    expect(audit.list().at(-1)).toMatchObject({
      operation: "system.time",
      decision: "executed",
      result: "success"
    });
  });

  it("replays a completed idempotent turn without calling the provider again", async () => {
    const { runtime, provider } = fixture([
      { text: "stable reply", toolCalls: [] }
    ]);
    const context = {
      correlationId: "corr-runtime-0003",
      actor: "user",
      idempotencyKey: "turn-runtime-0003"
    };

    const first = await runtime.runTurn({ text: "same input" }, context);
    expect(first.status).toBe("completed");
    if (first.status !== "completed") return;

    const replay = await runtime.runTurn(
      { text: "same input", sessionId: first.sessionId },
      context
    );
    expect(replay).toMatchObject({
      status: "completed",
      sessionId: first.sessionId,
      turnId: "turn-runtime-0003",
      text: "stable reply",
      replayed: true
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("rejects malformed provider output before tool execution", async () => {
    const { runtime, audit } = fixture([
      { toolCalls: [{ id: "", name: "system.time", arguments: {} }] }
    ]);

    await expect(runtime.runTurn(
      { text: "bad provider" },
      { correlationId: "corr-runtime-0004", actor: "user" }
    )).rejects.toBeInstanceOf(AssistantProviderError);
    expect(audit.list()).toEqual([]);
  });

  it("stops recursive tool use at the configured loop limit", async () => {
    const { runtime } = fixture([
      { toolCalls: [{ id: "call-loop-1", name: "system.time", arguments: {} }] },
      { toolCalls: [{ id: "call-loop-2", name: "system.time", arguments: {} }] },
      { toolCalls: [{ id: "call-loop-3", name: "system.time", arguments: {} }] }
    ]);

    await expect(runtime.runTurn(
      { text: "loop" },
      { correlationId: "corr-runtime-0005", actor: "user" }
    )).rejects.toMatchObject({ code: "EXTERNAL_SERVICE" });
  });

  it("honors cancellation before the provider is called", async () => {
    const { runtime, provider } = fixture([{ text: "should not run", toolCalls: [] }]);
    const controller = new AbortController();
    controller.abort(new Error("cancel fixture"));

    await expect(runtime.runTurn(
      { text: "cancel me" },
      { correlationId: "corr-runtime-0006", actor: "user" },
      controller.signal
    )).rejects.toMatchObject({ category: "cancelled" });
    expect(provider.requests).toHaveLength(0);
  });
});
