# P7: publisher signature verification in Updates UI

Read-only GET `/api/updates/verify` verifies the Ed25519 signature on release metadata against an independently pinned publisher public key and verifies repository and release-tag identity. The browser may request a check but cannot supply or replace the trust anchor. Missing publisher trust returns `not_configured`, and malformed or substituted signed metadata returns `failed`. Installation remains disabled in every response.

`PINNED_PUBLISHER_TRUST` in `apps/server/src/routes/update-verify.ts` is deliberately `null` until the public key fingerprint and key are provisioned as part of a separately trusted distribution. Never load these values from the latest GitHub release or a user-supplied URL. The server does not download or stage updates in this phase. Before enabling installs, provision release credentials and test signed download, restart supervision and rollback end to end.
