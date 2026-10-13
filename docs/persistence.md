# Persistence

Critical JSON state uses temporary file → complete write → fsync → atomic rename → best-effort directory sync.

`VersionedJsonStore` wraps state in `{ schemaVersion, data }` and applies explicit one-step migrations. Invalid state is quarantined with a `.corrupt-*` suffix and reported as degraded rather than crashing unrelated modules.

`JsonlStore` serializes concurrent appends and fsyncs each completed append. A domain owns its storage path and exposes a service interface; other domains never read that path directly.
