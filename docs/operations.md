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

## Release pipeline

A release candidate is built from a clean Git tree with Node 22.

The pipeline:

1. installs dependencies with lifecycle scripts disabled;
2. runs the full quality gate;
3. creates a clean `AkariyaTenka.zip`;
4. writes the source commit SHA to `.akariya-version`;
5. generates a CycloneDX SBOM;
6. generates a SHA-256 checksum;
7. downloads the candidate on Windows;
8. verifies checksum and SBOM syntax;
9. extracts into a path containing spaces;
10. launches `AKARIYA.bat` without system Node and verifies the pinned portable runtime.

For `v*` tags only, the verified ZIP is published as a GitHub Release together with its checksum and SBOM. GitHub artifact attestations are generated for build provenance and the SBOM.

The release ZIP contains application source, not `node_modules`, `.runtime`, user data or secrets. First launch remains responsible for portable runtime/bootstrap and dependency recovery.
