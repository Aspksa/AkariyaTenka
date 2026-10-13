# Architecture

Akariya Tenka is a long-lived modular system. `apps/*` may compose packages; packages never import from `apps/*`.

- `@akariya/core`: stable primitives only.
- `@akariya/contracts`: transport-facing schemas and inferred types.
- `@akariya/persistence`: safe storage primitives, migrations and durable idempotency.
- `@akariya/security`: capabilities, policy, approvals, secrets, audit and secure paths.
- `@akariya/assistant`: tool registry and execution orchestration.
- `@akariya/server`: composition root, adapters, services and HTTP routes.
- `@akariya/web`: presentation, typed API consumption and UI state.

A future domain owns its model, schema, service and store. Other domains call its public interface; they do not inspect its files or database tables.

## Request path

HTTP request → validated correlation/idempotency context → runtime schema → route/service → domain interface → persistence/network adapter → safe response contract.

The server stores request context in an `AsyncLocalStorage` adapter implementing the core `RequestContextScope` interface. The same scope is shared by HTTP, logging and outbound network boundaries. It carries `correlationId`, actor identity and an optional `idempotencyKey`.

Outbound network calls propagate the correlation ID for diagnostics but never automatically forward the idempotency key to an external service.

## Assistant action path

User → Assistant/LLM → Structured Tool Call → Runtime Schema Validation → Security Policy → Approval Gate → Execution → Audit → Result.

Approval and audit records are bound to the same request correlation and optional idempotency identity. The model proposes actions. The application owns execution authority.

## Time

Time-sensitive runtime behavior depends on the core `Clock` abstraction. Approval TTLs, tool/audit timestamps, health timestamps, logger timestamps and scheduler diagnostics can therefore be tested with deterministic clocks.
