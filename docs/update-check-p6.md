# Update Manager P6 — read-only GitHub release discovery

The Updates page can request `GET /api/updates/check` to discover the latest stable release tag published in `Aspksa/AkariyaTenka`. The server limits response size, uses a fixed GitHub API endpoint and an 8-second timeout, and does not install, download or modify project files. The UI visibly states that discovered release metadata is **not a verified publisher signature** and links to the GitHub release.

The installer remains disabled. Untrusted version names and the GitHub response are not treated as a trust anchor; do not use this endpoint to authorize update installation. A separately provisioned pinned publisher key and end-to-end signed discovery are still required before enabling download/install operations.
