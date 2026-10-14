# P0/P1 portable safety upgrade (experimental)

This set extends the portable foundation with:
- `runtime.lock` retained by the launcher until supervised shutdown. Sync refuses an existing runtime lock, and startup refuses an existing sync lock. A stale lock after forced termination must be inspected and removed manually. Existing external tools and concurrent database writers are **not** coordinated.
- `portable-replace.mjs plan <source> <destination>` analyses changed files against a shared immutable baseline; `apply ... --both-stopped` copies eligible changes, requires both project copies stopped, refuses divergent edits or deletions, takes a verified destination backup, checks SHA-256, attempts in-process rollback on failure. It is **not crash-atomic** across arbitrary power loss; journal-based recovery and baseline advancement are still needed. The baseline snapshots must have been initialized identically on both copies. Do not move live databases. No SQLite schema-aware merge is implemented.
- `portable-discover.mjs` searches candidate drive roots for an Akariya installation UUID and launcher. This is CLI discovery, not a mounted-volume event monitor or graphical manager.
- `portable-key-vault.mjs` implements AES-256-GCM + scrypt encryption/decryption in a private project folder with a distinct passphrase supplied by a trusted local caller. No plaintext password or secret is accepted on CLI; no unlocked secret is automatically supplied to the updater. The vault is excluded from project transfer and Git. Store an independent recovery copy of its secret/passphrase; password loss may make the key unrecoverable.

**Do not treat a passing CI build as validation of power-cut or unplug resilience.** File-level rollback only handles exceptions when the program continues running, not a forcibly disconnected SSD or sudden power failure. Test on disposable copies first.

The publisher's real private key and trusted public fingerprint have not been provisioned. Official release installation stays disabled until the owner provisions a genuine release signing key and the trusted distribution pins its public key by a separately authenticated channel. It would be unsafe to invent a signing key or insert a repository-controlled downloaded key as its own trust authority.

The full user-facing desktop sync manager, database checkpoint coordination, automatic baseline advancement, resumable transfer journals, and integration-level USB-disconnect tests are still pending. Direct SSD launch and existing non-overwrite modes are retained.
