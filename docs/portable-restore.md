# Restore a verified portable backup to a NEW folder

This safe recovery step restores a previously verified `.portable-state/backups/<backup-id>` snapshot into a separate, nonexisting destination directory. It never intentionally edits or overwrites live Akariya files and never automatically merges databases.

Before proceeding, stop the Akariya launcher, backend, and every other writer. Use the backup identifier printed by `portable-backup.mjs create`:

```powershell
node scripts/portable-restore.mjs restore "E:\AkariyaTenka" "<backup-id>" "C:\AkariyaRecovered" --stopped
```

The command validates the backup and installation identity, rejects source/destination overlap and preexisting destination paths, copies to a temporary staging directory on the target volume, checks SHA-256 of the restored files, verifies the source backup again and renames the staged directory into the new destination. If validation or copying fails, staging is removed.

The recovered folder deliberately does **not** include `node_modules`, Git metadata, `.portable-state` history, or `keys/private`, because they are excluded from portable backups. The normal launcher may reconstruct dependencies.

Limitations: `--stopped` is acknowledgement rather than an OS-enforced process lock; the target path can still race with another process between the existence check and rename. For hostile shared directories, use a trusted, empty parent folder with controlled permissions. This is **not** automatic rollback, bidirectional sync, or SQLite-level online backup. Inspect the recovered copy before treating it as canonical and retain the original backup. Maintain a second physical backup separate from the SSD.
