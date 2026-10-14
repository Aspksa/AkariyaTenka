# P9 — Publisher key bootstrap (one-time, owner-operated)

Production key **is not configured** by committing this phase. Never generate a long-lived private release key inside CI, a ChatGPT session, or repository source control. ChatGPT developers and feature branches do not need the signing key.

## Owner-only setup on a trusted computer

1. Choose an empty absolute directory **outside** the checkout on encrypted storage, with private filesystem access. For example on Windows: `C:\\Users\\<your-user>\\PrivateAkariyaPublisherKey`. Its parent directory must exist. Do not use cloud-synced/shared folders.
2. With Node 22+ installed locally run: `node scripts/provision-publisher-key.mjs "<absolute-empty-key-directory>"`. The script rejects locations in the checkout, refuses an existing destination, creates a new Ed25519 keypair and writes `publisher-private.pem`, `publisher-public.pem`, `publisher-spki-sha256.txt`.
3. Before entering anything into GitHub settings, run `node scripts/verify-publisher-keypair.mjs "<absolute-key-directory>"` on the same trusted computer. It checks that the private and public keys match and that the recorded SPKI SHA-256 fingerprint is correct, without printing the private key.\n4. Keep an encrypted offline backup of the private key, restricted to the owner. Never paste it in ChatGPT, PR comments, GitHub issues, terminal transcripts, or commit it. On Windows confirm file ACLs: POSIX mode 0600 is not a Windows access-control guarantee.
5. In **repository Settings → Secrets and variables → Actions**, create secret `AKARIYA_RELEASE_SIGNING_KEY_PEM` with the full contents of `publisher-private.pem`. Create variables `AKARIYA_RELEASE_PUBLIC_KEY_PEM` with `publisher-public.pem` and `AKARIYA_RELEASE_PUBLIC_KEY_FINGERPRINT` with the lowercase hash from `publisher-spki-sha256.txt`. GitHub Actions Release uses those names and rejects missing or mismatched values.
6. Separately pin the public PEM and fingerprint in a *trusted distributed application build*; verify fingerprint through an independent owner-approved channel. The current application's `PINNED_PUBLISHER_TRUST` is intentionally `null`; merely setting GitHub variables does NOT make client verification work.
7. Protect the tagged release workflow and restrict who can publish version tags or modify workflow code. Consider a protected GitHub Environment or an external signing service for stronger isolation. The current repository-secret workflow executes on tagged commits, so restrict tag creation to trusted reviewed commits.
8. Before release installation is enabled, validate genuine signatures and forged/tampered assets, archive digest, launcher restart, rollback and backup restoration in an isolated Windows environment.

## Do not

- Do not create a new publisher key for each normal code update. Keep one trusted keypair for releases until a deliberate key rotation.
- Do not add a fallback testing key or silently permit unsigned releases.
- Do not treat metadata downloaded from GitHub as an independent trust anchor.
- Do not enable download/install buttons merely because the GitHub repository secret is set.

Only an owner with GitHub administrative rights can complete the secret/variable configuration and independently approve the public trust anchor. The P9 code supplies the local bootstrap and tests, **not the operational secret**.
