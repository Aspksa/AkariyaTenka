# Verified portable backups (foundation)

This step creates a separate, immutable snapshot of all portable application files under `.portable-state/backups/<uuid>/`. The backup includes project data, memory, config and public keys, but follows the same exclusions as `portable-transfer`: `.git`, dependencies and `keys/private` are not copied. A release signing private key must not be stored unencrypted in the project.

Stop Akariya, the launcher, and any other process writing into the folder before running:

```powershell
node scripts/portable-backup.mjs create "E:\\AkariyaTenka" --stopped
node scripts/portable-backup.mjs verify "E:\\AkariyaTenka" "<backup-id>"
```

Creating a backup requires an existing portable installation identity. Each file is checked with SHA-256 after copying, and the source is rechecked before the backup is published. Failed staging is removed, and no existing backup is overwritten. The backup never alters the live files.

**Limitations:** This is not yet an atomic database snapshot, a restore operation or an end-to-end transactional sync. The `--stopped` flag is an explicit acknowledgement, not a process lock; a hostile or malfunctioning concurrent writer can still race with the backup. Verification detects unintended changes but does not authenticate a backup against a malicious attacker who can edit both backup files and its manifest. SSD loss also destroys same-disk backups: maintain a second offline backup on a different device. A future release will add coordinated stop/locking, durable backup metadata and safely checked restoration before enabling modified-file replacement.
