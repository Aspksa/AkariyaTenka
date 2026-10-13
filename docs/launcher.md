# Akariya Tenka launcher architecture

Akariya Tenka has one startup architecture. Windows users start `AKARIYA.bat`; npm users run `npm start`; development uses `npm run dev`. All three paths end in `scripts/launch.mjs`.

## Windows bootstrap

`AKARIYA.bat` is intentionally small. It changes to its own directory, validates Node.js 20+, checks the project-local runtime at `.runtime/node`, and invokes `scripts/bootstrap-node.ps1` only when no suitable runtime exists.

The portable runtime is installed without administrator rights. `bootstrap-node.ps1` pins a Node.js release, supports Windows x64 and ARM64, downloads only from `nodejs.org`, verifies the archive against the official `SHASUMS256.txt`, extracts into `.runtime/_extract`, verifies the extracted runtime, then moves it into `.runtime/node`. The project-local runtime is added only to the current launcher process PATH.

## Supervisor

`scripts/launch.mjs` owns orchestration:

1. roll back an update that never received startup confirmation;
2. apply a manual rollback request;
3. install a prepared update transactionally;
4. validate Node.js;
5. validate dependency binaries, lockfile stamp, and all npm workspace links;
6. recover dependencies with `npm ci` (or `npm install` only without a lockfile);
7. run typecheck and tests unless `--skip-checks` was explicitly supplied;
8. build the server bundle and, in production mode, the web application;
9. bind-check and select a free loopback port;
10. start and supervise the backend and optional Vite process;
11. poll `/api/health` for up to 30 seconds;
12. confirm a newly installed update only after startup health succeeds;
13. open the browser unless `--no-open` was supplied;
14. propagate shutdown and restart children cleanly.

Supported public flags:

- `--dev` — run the backend plus Vite development server;
- `--no-open` — do not open a browser;
- `--skip-checks` — explicitly skip pre-start typecheck/tests for developer debugging;
- `--port N` — start searching for a free backend port from `N`.

The backend listens on `127.0.0.1` by default. The launcher intentionally uses a loopback-only desktop network model.

Exit code `75` is reserved for a supervised restart request.

## Dependencies

The existence of `node_modules` is never treated as proof of a healthy install.

`scripts/workspace-health.mjs` verifies all current workspaces:

- `@akariya/core`
- `@akariya/contracts`
- `@akariya/persistence`
- `@akariya/security`
- `@akariya/assistant`
- `@akariya/server`
- `@akariya/web`

It validates each linked package manifest and verifies that the real filesystem target points at the expected workspace source directory.

The SHA-256 hash of `package-lock.json` is stored in `node_modules/.akariya-lock`. A missing or changed stamp, missing required tool, broken workspace link, update, rollback, or explicit `AKARIYA_REINSTALL=1` causes dependency recovery.

Dependency recovery uses `--no-audit --no-fund --ignore-scripts`. CI uses the same scriptless install mode and must prove that the complete build works with it.

## Server build

`scripts/build-server.mjs` produces:

`apps/server/dist/server.mjs`

The bundle targets Node.js 20+, uses ESM, and bundles Akariya workspace source packages into the server runtime artifact. Production web assets are built separately with Vite.

## Transactional updates

`scripts/apply-update.mjs` is the trusted install/rollback side of the updater. A downloader or future update service must stage and verify candidate code before creating `.updates/ready.json`.

Protected installation state includes:

- `.git`
- `.updates`
- `.env` and private `.env.*` variants
- `data`
- `.runtime`
- `node_modules`
- `.akariya-version`
- secret-storage directories

`.env.example` remains application code and may be updated.

Before changing any installed application file, the updater validates the complete manifest, duplicate/conflicting paths, every staged blob hash, destination path chains, and symlink/junction escape conditions. Windows reserved names, absolute paths, traversal, backslashes, ADS/colon syntax, trailing dots, and trailing spaces are rejected.

Only files that actually change are backed up. Installation uses adjacent temporary files followed by rename. File removals require explicit confirmation bound to the exact update SHA.

A successful file installation creates `.updates/pending-confirm.json`. The launcher removes that marker only after the new server responds successfully to `/api/health`. If startup fails, the previous backup is restored automatically and the previous version is relaunched.

Manual rollback requests use `.updates/rollback-request.json`. Update history and detailed events are appended to `.updates/history.jsonl` and `.updates/events.jsonl`. Only the newest three controlled backups are retained.

## Runtime state

These paths are local runtime state and are not committed:

- `.runtime/`
- `.updates/`
- `.akariya-version`
- `node_modules/`
- `data/`
- `.env`

User data and secrets are therefore kept outside the application-code update transaction.

## Verification

CI runs on Windows and Ubuntu. It verifies a lifecycle-script-free npm install, launcher JavaScript syntax, PowerShell bootstrap syntax on Windows, TypeScript, launcher/updater tests, the project test suite, both builds, and a real HTTP smoke test.
