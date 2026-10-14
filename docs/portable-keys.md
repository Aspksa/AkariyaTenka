# Project-local keys and portable copies

The owner may keep a `keys/` directory inside **AkariyaTenka**, including on an external SSD, but signing credentials have different security requirements.

```text
AkariyaTenka/
  keys/
    public/
      publisher-public.pem          # public verification key (owner-provisioned)
      publisher-spki-sha256.txt     # independently authenticated fingerprint
    private/
      signing-vault.enc             # OPTIONAL encrypted vault, owner-only
```

`keys/public/` can accompany a portable copy and is suitable for public publisher-verification material, **but it is not automatically trusted**. The fingerprint must first be independently approved and pinned in the trusted application. The current `PINNED_PUBLISHER_TRUST` remains `null` until that provisioning happens; merely placing files here must NOT enable release installation.

`keys/private/` is Git-ignored and excluded from `portable-transfer` and `portable-sync`. Never store the raw `publisher-private.pem` or GitHub Actions signing secret here, and never copy the private key to a work computer. An encrypted vault inside the project is optional; it must use a separate strong passphrase or hardware-held key (not stored with the vault), and the owner must ensure encryption and access controls. **This repository does not currently implement vault encryption or unlocking.** Generate the raw signing key outside the project using the existing owner-only key provisioning script, then store the real publisher secret only in approved protected storage/GitHub Actions.

The external SSD can be used to launch Akariya directly, and safe portable copies can be made on home/work machines. Keep Akariya stopped before transfers. Do not treat an existing-copy additive sync as a complete replacement of changed databases: conflict-aware transactional synchronization remains a future feature.

If a signing key is exposed, rotate it deliberately; never generate a fresh publisher key for each ordinary update.
