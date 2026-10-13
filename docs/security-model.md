# Security Model

Tools declare explicit capabilities: `read_local`, `write_local`, `delete_local`, `network_read`, `network_write`, `external_write`, `process_exec`, `credential_access`, `system_change`.

Approval is fail-closed, single use, time limited and bound to correlation ID, actor, operation, capabilities and a canonical digest of validated immutable arguments. Changing arguments invalidates the grant.

Business code depends on `SecretStore`, not `process.env`. The initial adapter is in-memory; future durable secret storage must be OS-backed or encrypted. Plaintext per-key files are not accepted.

`SecurePathResolver` rejects traversal, drive/UNC paths, alternate data streams, reserved Windows names and symlink escapes.
