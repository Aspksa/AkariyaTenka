# Update Manager P2 — trusted archive preparation

This phase introduces `scripts/prepare-update.mjs` as the bridge between a downloaded release ZIP and the existing `scripts/apply-update.mjs` installer.

## Trust requirement

`prepareTrustedRelease` requires a **SHA-256 value obtained from a separately trusted source**, and the exact 40-character Git source commit. A checksum downloaded alongside the ZIP is NOT sufficient evidence of authenticity. Do not pass `downloadVerifiedRelease().sha256` straight into this trust parameter: both the ZIP and checksum may be controlled by the same compromised release endpoint.

Production publisher-authentication automation (pinned signing key or independently verified provenance), an authenticated server route, UI, user confirmation and restart orchestration are **not yet implemented**. This API is intentionally not connected to automatic installation.

## Preparation sequence

1. The caller explicitly supplies `root`, `archivePath`, `trustedSha256` and `sourceSha`.
2. Verify the entire archive against the independently trusted SHA-256 before parsing.
3. Parse a bounded ZIP directory; reject traversal, protected paths, duplicate case-insensitive paths, links, unsupported ZIP64/encryption, zip bombs and corrupted CRCs.
4. Require the prebuilt manifest and exact server/web outputs. Recheck every declared build artifact by SHA-256.
5. Write safe files to a new staging directory. Generate a launcher-compatible `.updates/ready.json` only after staging succeeds.
6. The existing launcher may subsequently install the staged files on restart, confirm health, or roll back.

Archive entry paths can never overwrite `.env`, `data`, `.runtime`, `.git`, `.updates`, `node_modules` or secrets. The archive `.akariya-version` file is deliberately ignored, because the installer manages that marker itself.

Run `node --test scripts/prepare-update.test.mjs` or the project quality gate.

## Remaining before an end-user update button

- A pinned publisher key / verified signed release metadata and CI generation of signature
- Hardening of crash/interruption recovery and atomic staging coordination
- Administrator-safe loopback API for check / download / prepare / restart
- Explicit user confirmation, status/progress web UI and Windows end-to-end testing
