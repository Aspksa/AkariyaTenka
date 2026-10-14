# Publisher trust provisioning

The installed application verifies signed releases only after the owner has explicitly provisioned an independent Ed25519 public key and its SPKI SHA-256 fingerprint.

Place these two **public** files locally into `keys/public/`:

- `publisher-public.pem`
- `publisher-spki-sha256.txt`

Use the existing `scripts/import-publisher-key.mjs` workflow on the owner's trusted machine to import the actual publisher identity. It validates the Ed25519 pair and stores the private key encrypted under `keys/private/`. Never paste the private key into ChatGPT, commit it, or bundle it in releases.

The fingerprint must be verified out-of-band against the intended publisher identity. A fingerprint supplied by the same untrusted release is **not independent trust**. Merely downloading a public key from GitHub Releases does not establish its authenticity.

The server reads these files at bootstrap, verifies the public key type and matching fingerprint, and passes the trust to the release-verification route. Missing keys mean `not_configured` and installation remains disabled. Invalid/incomplete material causes startup to fail rather than silently weakening trust.

The updater explicitly rejects all paths containing `keys/`. Changing or rotating the trusted publisher identity requires a separate, owner-authorized provisioning operation, not an ordinary application update.

**Important:** release verification is a read-only feature at this stage; installation via web UI remains disabled until the separate supervised installer is deliberately authorized and tested.
