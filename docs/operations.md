# Operational policy

## Runtime state retention

Akariya Tenka keeps operational state bounded.

Idempotency records are retained for a configurable TTL and capped by entry count. The defaults are seven days and 10,000 records. Expired records are removed during normal store access. Reusing an idempotency key after its retention window is therefore treated as a new operation; callers must not use idempotency retention as permanent business history.

Audit JSONL files rotate before they exceed the configured byte limit. By default the active audit file is capped at 10 MiB and five numbered archives are retained. Recent JSONL reads can use a bounded streaming reader instead of loading the whole file into memory.

The settings are exposed through:

- `AKARIYA_IDEMPOTENCY_TTL_HOURS`
- `AKARIYA_IDEMPOTENCY_MAX_ENTRIES`
- `AKARIYA_AUDIT_MAX_BYTES`
- `AKARIYA_AUDIT_MAX_ARCHIVES`

## Health

`GET /api/health` combines Kernel lifecycle health with operational contributors.

Current contributors include:

- runtime
- scheduler
- audit storage
- idempotency storage
- secret backend

A recoverable storage problem reports `degraded`; an unrecoverable lifecycle failure reports `failed`. Health checks must not expose credentials or raw user data.

## Shutdown and crash policy

SIGINT and SIGTERM use the same shutdown coordinator as `uncaughtException` and `unhandledRejection`.

Cleanup order is:

1. stop accepting HTTP work;
2. stop runtime lifecycle components;
3. flush persistence.

The shutdown deadline defaults to 10 seconds and is configurable with `AKARIYA_SHUTDOWN_TIMEOUT_MS`. If cleanup exceeds the deadline the process is force-terminated with a non-zero code so the launcher never mistakes a hung shutdown for success.

## Dependency policy

Automated dependency PRs are intentionally limited to minor and patch updates. Major version changes are manual migration work and require an explicit branch, release-note review, full Windows/Linux CI and launcher/release smoke coverage.

Runtime dependency security is checked separately from general version freshness.

## Build and local distribution

Continuous integration tests the source checkout on Windows and Ubuntu with Node.js 20 and 22.
Local builds use `npm run build`. The Windows launcher can bootstrap an integrity-checked
portable Node.js runtime without administrator privileges. Generated build outputs are
never a reason to discard local user data.

The project deliberately has no application update, rollback, device-transfer or
publisher-signing workflow. New versions are distributed only through an explicit
developer-controlled source/build delivery process; there is no automatic installation.
