# Portable state snapshot (read-only ancestry detection)

This first baseline mechanism reports which files changed on each copy after a common starting point. It does **not** merge files, replace databases, write backups or enable overwrite.

1. Close all Akariya instances and tools writing into both copies.
2. Ensure the SSD source already has its installation UUID and make a verified initial copy.
3. While both copies have exactly the same files, run `node scripts/portable-state.mjs init "E:\\AkariyaTenka"` and `node scripts/portable-state.mjs init "C:\\AkariyaTenka"`. The two baseline files are local immutable metadata and are excluded from portable transfer scanning.
4. After working on either copy, run `node scripts/portable-state.mjs compare "E:\\AkariyaTenka" "C:\\AkariyaTenka"`.

`status: "shared-baseline"` indicates identical recorded baselines; `changedLeft`/`changedRight` report deviations from it; `conflicts` reports the same path modified differently on both sides. `unavailable` and `different-baseline` prohibit automated conflict decisions. Changes after snapshot are **not** transferred or applied by this command. Never overwrite SQLite or active databases based on a file hash alone.

The initial snapshot is immutable: an attempt to recreate it fails rather than silently changing shared history. Later work must implement supervised shutdown/locks, transactional state snapshots and backups, and an explicit verified baseline advancement mechanism. A shared UUID is not sufficient to prove identical ancestry.

Publisher release signing credentials are independent of this feature. The real publisher private key has not been configured, and signed release auto-install remains disabled.
