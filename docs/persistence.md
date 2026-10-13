# Persistence

Critical JSON state uses temporary file → complete write → fsync → atomic rename → best-effort directory sync.

`AtomicJsonStore`, `VersionedJsonStore` and `JsonlStore` serialize mutations through `SerializedQueue`. Concurrent writes therefore cannot interleave at one store instance, and reads that depend on a completed mutation are queued behind it.

`VersionedJsonStore` wraps state in `{ schemaVersion, data }` and applies explicit one-step migrations. Invalid JSON is quarantined with a `.corrupt-*` suffix. If migration output fails its runtime schema, the original state is also quarantined and returned as degraded rather than crashing unrelated modules.

`JsonlStore` serializes concurrent appends and fsyncs each completed append.

## Idempotency

`FileIdempotencyStore` is the durable foundation for repeatable side effects. A key is bound to a SHA-256 fingerprint of immutable validated arguments. Concurrent calls with the same key and fingerprint execute the protected operation once and replay the recorded result.

Reusing an existing key with a different fingerprint fails with `IdempotencyConflictError`. Corrupt durable idempotency state fails closed instead of risking duplicate side effects.

A domain owns its storage path and exposes a service interface; other domains never read that path directly.
