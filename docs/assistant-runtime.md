# Assistant runtime

Akariya Tenka treats the model as an untrusted planner, not as an authority.

## Turn path

```text
User turn
  -> ConversationStore
  -> bounded MemoryStore retrieval
  -> AssistantProvider
  -> runtime validation
  -> structured tool calls
  -> ToolExecutor
  -> SecurityPolicy / ApprovalGate
  -> AuditSink
  -> tool results
  -> provider continuation
  -> final assistant message
  -> ConversationStore
```

The provider returns `unknown`. `AssistantRuntime` validates every provider response before a tool can be selected.

## Provider boundary

`AssistantProvider` receives provider-portable DTOs only:

- bounded conversation messages;
- bounded explicit memory snippets;
- tool names, descriptions and JSON input schemas.

The runtime supports cancellation and normalizes provider failures through `AssistantProviderError`. CI uses `ScriptedAssistantProvider`; no real network provider or API key is required.

## Tool boundary

A provider cannot execute a tool directly. All calls go through the existing `ToolExecutor`, which performs:

1. runtime input validation;
2. capability/risk policy;
3. approval when required;
4. tool execution;
5. runtime output validation;
6. audit.

The initial built-ins are intentionally read-only:

- `system.time`;
- `system.runtime`;
- `memory.search`.

No filesystem write, process execution, credential access, external write or system-change tool is registered.

## Conversation semantics

Turns are serialized per session so concurrent calls cannot interleave their message history.

If a request context contains an idempotency key, that key becomes the turn id. A completed matching turn is replayed without calling the provider again. Reusing the same key with different user text fails with a conflict. An incomplete turn also fails closed instead of silently replaying partial state.

Tool recursion is bounded. History, memory retrieval, tool count, tool output size and provider response size all have explicit limits.

## Memory semantics

Memory is explicit. User messages are not automatically promoted into long-term memory.

Every memory record has:

- a scope;
- text;
- source kind and optional source reference;
- tags;
- created/updated timestamps.

This keeps provenance available and prevents the first runtime version from indiscriminately persisting secrets or conversational noise. Vector retrieval is deliberately deferred; the first implementation uses deterministic bounded lexical retrieval.

## Persistence

Production Node 22 uses `assistant.sqlite` with:

- SQLite WAL;
- `synchronous=NORMAL`;
- busy timeout;
- foreign keys;
- indexed sessions/messages/memory;
- `quick_check` health probe;
- WAL checkpoint during flush/close.

Node 20 source/dev mode uses an atomic JSON fallback with the same store contracts.

## HTTP exposure

There is no public Assistant HTTP endpoint in this phase. The runtime is composed inside the server but remains internal until the localhost Host/Origin/session-token boundary is hardened.
