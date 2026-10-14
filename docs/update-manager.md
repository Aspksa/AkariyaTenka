# Update Manager — phase 1

The existing transactional installer lives in `scripts/apply-update.mjs`; the launcher owns the installation, health confirmation and rollback. This phase adds `scripts/update-manager.mjs`, a **discovery and download-only** helper.

## API

- `checkLatestRelease({ fetchImpl?, signal? })` fetches the latest non-draft, stable release of `Aspksa/AkariyaTenka` from the GitHub Releases API and validates expected ZIP/checksum assets.
- `compareVersions("v1.2.3", "v1.2.2")` compares supported semver tags.
- `downloadVerifiedRelease({ release, updatesDir, fetchImpl?, signal?, onProgress? })` downloads the currently advertised release to `.updates/downloads/`, with SHA-256 verification and bounded streaming. It never writes `ready.json`, unpacks the ZIP, requests a restart or changes installed files.

## Deliberate safety boundary

A checksum downloaded from the same GitHub release only detects download corruption or tampering against the fetched checksum. It does **not** independently authenticate the publisher. Do not automatically install packages from this API. Before introducing installation, require trusted signatures / attestations validated against a pinned publisher identity, archive-entry validation, staging manifest construction, isolated tests/build or verified prebuilt artifact inspection, operator consent for deletions, and use the existing launcher rollback protocol.

No UI or server route is exposed in this phase. No scheduler polls GitHub without user permission. The download-only helper must not be invoked from untrusted LLM/tool calls.

Run `node --test scripts/update-manager.test.mjs` or `npm run check` for the suite.
