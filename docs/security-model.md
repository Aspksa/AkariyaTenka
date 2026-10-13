# Security Model

Tools declare explicit capabilities: `read_local`, `write_local`, `delete_local`, `network_read`, `network_write`, `external_write`, `process_exec`, `credential_access`, `system_change`.

Approval is fail-closed, single use, time limited and bound to correlation ID, actor, optional idempotency key, operation, capabilities and a canonical digest of validated immutable arguments. Changing any bound identity or arguments invalidates the grant.

Audit events carry the same correlation and optional idempotency identity. Approval state is not mutated until its audit event is persisted successfully.

Business code depends on `SecretStore`, not direct `process.env` reads. The production bootstrap uses the read-only `EnvironmentSecretStore` namespace `AKARIYA_SECRET_*`; it cannot mutate process environment or write plaintext secret files.

Logging uses a secret redactor that removes values from secret-like environment variables even when those values appear under non-secret field names. Keys such as token, password, API key, authorization and credential are redacted recursively.

`SecurePathResolver` rejects traversal, drive/UNC paths, alternate data streams, reserved Windows names and symlink/junction escapes.

Outbound network calls propagate correlation IDs for diagnostics but do not automatically forward idempotency keys or other request credentials.
