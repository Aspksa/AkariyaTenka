# Architecture

Akariya Tenka is a long-lived modular system. `apps/*` may compose packages; packages never import from `apps/*`.

- `@akariya/core`: stable primitives only.
- `@akariya/contracts`: transport-facing schemas and inferred types.
- `@akariya/persistence`: safe storage primitives and migrations.
- `@akariya/security`: capabilities, policy, approvals, secrets, audit and secure paths.
- `@akariya/assistant`: tool registry and execution orchestration.
- `@akariya/server`: composition root, adapters, services and HTTP routes.
- `@akariya/web`: presentation, typed API consumption and UI state.

A future domain owns its model, schema, service and store. Other domains call its public interface; they do not inspect its files or database tables.

## Request path

HTTP request → correlation context → runtime schema → route/service → domain interface → persistence/network adapter → safe response contract.

## Assistant action path

User → Assistant/LLM → Structured Tool Call → Runtime Schema Validation → Security Policy → Approval Gate → Execution → Audit → Result.

The model proposes actions. The application owns execution authority.
