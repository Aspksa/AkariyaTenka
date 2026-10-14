# Akariya Tenka launcher

The project starts with `AKARIYA.bat` on Windows or `npm start` with Node.js 20+.
The batch launcher bootstraps a pinned portable Node.js into `.runtime/node`
when necessary, without an administrator install. The downloaded Node.js archive
is verified against the official Node.js SHA-256 checksums.

`scripts/launch.mjs` checks the single-instance lock under `.runtime/runtime.lock`,
verifies a prebuilt local distribution when available, or installs dependencies
and runs typecheck/tests/build for a source checkout. It then starts the backend,
polls `/api/health`, and opens the local browser.

Options: `--dev`, `--no-open`, `--skip-checks`, `--port N`.
A stale lock with a demonstrably dead PID is archived; ambiguous lock metadata
fails closed and requires manual inspection. The lock is not a transfer feature.

Application updates, automated rollback, publisher signing keys, and device
transfer are not part of this launcher. The `.runtime/` directory is local
runtime state and must not be committed.

The ordinary launcher retains process supervision, health checks, crash-loop
protection, and clean shutdown.
