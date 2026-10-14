# Signed update client

`scripts/signed-update.mjs` verifies Ed25519 publisher metadata from GitHub Releases against a public key and fingerprint supplied by an independently trusted installation. It confirms the signed release tag and expected ZIP size before downloading, binds the downloaded digest and size to signed metadata, and only then invokes the existing staging routine. Launcher installation and rollback remain separate.

Do not obtain the public key or fingerprint from the same release being checked. In the absence of a provisioned trusted key, the client fails closed. The project does not yet have independently pinned production publisher credentials or a web update/approval route. Do not activate unattended updates until those are deployed and tested. Verify rollback compatibility for database migrations before enabling installation.
