# GitHub updates

Akariya Tenka checks the official `Aspksa/AkariyaTenka` `main` branch through
the GitHub API. The dashboard shows the local revision, current GitHub SHA and
a link to compare changes.

## Installing updates (Windows)

Click **Обновления GitHub → Установить обновление** and approve the confirmation.
The local server records the exact 40-character SHA fetched from the official
GitHub API, shuts down cleanly and hands control to the launcher.

The launcher downloads that immutable commit's ZIP via HTTPS. Before touching
the application, the installer validates all ZIP entry names and rejects
traversal, reserved Windows filenames, duplicate paths and symlinks. It
extracts into a separate local staging directory, installs dependencies there
and runs the full test/typecheck/build quality gate.

After successful validation, the launcher holds an exclusive instance lock.
The installer journals a backup, replaces only enumerated application paths,
writes the new version marker and probes the updated backend over loopback.
On installation or health-check failure it restores the prior application
and its version/build metadata. Interrupted operations are rolled back at
the next launcher start.

`data/`, `.env`, `.git`, `node_modules/`, `.runtime/`, `keys/`, and
`.keys/` are never included in the replacement set. The updater does not
create or require signing keys. Backups and transaction records are stored in
`.runtime/github-updater/`. Do not manually delete that directory while
an update or recovery is in progress.

## Constraints

- Automated installation is currently **Windows-only**. On Linux/macOS the
  update check works but installation is not supported.
- A GitHub API revision difference alone does not prove a safe upgrade path;
  a preview link is provided before explicit user confirmation.
- The current running app must already include this updater. Older local
  installations require a **one-time manual refresh** to bootstrap it.
- GitHub must be reachable, and the staging process requires npm access.
- The post-install health check verifies the backend. It does not prove all
  external integrations function correctly, so keep backups.
