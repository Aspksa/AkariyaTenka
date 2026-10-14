# Portable synchronization locks — cooperative protection

When using `node scripts/portable-sync.mjs add ... --both-stopped`, Akariya now creates an exclusive `.portable-state/sync.lock/` directory **in each project copy** before evaluating and transferring additions. Both locks are acquired in stable path order. If either copy is already locked, the transfer fails without overwriting any existing file. Successful and failed operations release only their own locks.

This is a cooperative lock for the portable sync CLI. It is **not** an operating-system guarantee that Akariya, external editors, database processes, or other backup/restore utilities have stopped. Always stop Akariya and other writers, and never unplug the SSD during file operations. An interruption or crash can leave a stale lock; inspect the machine and process state before manually clearing it. Do **not** automatically break locks based on age.

The existing additive-only behavior is unchanged: modified files are not merged or overwritten; divergent SQLite databases require application-aware handling. Snapshot comparison, immutable backups, and restore-to-new-directory remain separate tools. The next stage must coordinate launcher supervision and backups with the locking protocol before permitting transactional modified-file replacement.

Publisher private keys remain excluded from portable transfers. No production signing trust has been enabled.
