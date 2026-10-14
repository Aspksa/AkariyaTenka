# Update Manager P3

This phase adds Ed25519 release metadata verification and an explicit signing helper. Automatic installation remains disabled until a stable publisher signing key and independently pinned public-key fingerprint are provisioned.

The signed metadata binds repository name, stable version tag, source commit SHA, archive SHA-256 and byte size. The key fingerprint must be trusted independently of the release endpoint. Never commit private signing keys.

Next: configure protected publisher credentials, integrate signatures into tagged release publishing, verify signed metadata before calling prepareTrustedRelease, then build an authenticated local update UI and end-to-end rollback tests.
