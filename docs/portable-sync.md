# Portable Sync — additive-only safe phase

Akariya Tenka can be run directly on an SSD with `AKARIYA.bat`, or copied to a local Windows machine. This phase adds **existing-copy comparison** and **additive-only** file transfer. It deliberately does not overwrite, merge, or remove any existing file, including SQLite databases or conversation history.

After stopping Akariya and all writers on **both** locations:

```powershell
node scripts/portable-sync.mjs plan "C:\AkariyaTenka" "E:\AkariyaTenka"
node scripts/portable-sync.mjs add "C:\AkariyaTenka" "E:\AkariyaTenka" --both-stopped
```

The `plan` command lists:
- `additions`: files only in source;
- `destinationOnly`: files only in destination;
- `conflicts`: paths existing in both with unequal SHA-256 content.

The `add` operation is refused if any conflicts exist, if paths overlap, if the publisher private key is inside either tree, or if the user has not explicitly acknowledged shutdown. It uses exclusive file creation and checks copied SHA-256 digests. A interrupted run may leave some newly added files in place, so rerun `plan` to assess before attempting again. It never overwrites existing files. To move in the opposite direction, reverse the arguments.

**Important:** Different files may still represent linked state; this tool is for cautious incremental additions, *not* a guarantee of a consistent two-way data merge. For existing databases/history, keep a single canonical copy and make a full closed-app backup before changing devices. Do not run this operation on two live instances. A future step will require durable ancestry metadata, transactional backups, locks across locations, and a conflict-resolution UI before safely replacing modified files.

Signing material stays separate. Only public trusted verification metadata may accompany distributed application copies. `publisher-private.pem` is excluded by refusal, and the official signing secret is still not configured through ChatGPT.
