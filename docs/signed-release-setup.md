# Signed release publishing

Tagged GitHub releases now require an Ed25519 publisher signature and a verified archive. The publish job fails closed if signing configuration is missing. PR and manual release-candidate workflows continue to run without publisher secrets.

Provision these repository settings using secure administrative access:

- Secret `AKARIYA_RELEASE_SIGNING_KEY_PEM`: stable Ed25519 PKCS#8 private key, never in source control or release artifacts.
- Variable `AKARIYA_RELEASE_PUBLIC_KEY_PEM`: corresponding SPKI public PEM.
- Variable `AKARIYA_RELEASE_PUBLIC_KEY_FINGERPRINT`: lowercase SHA-256 of DER SPKI public key.

The public-key fingerprint must ALSO be pinned independently in the installed application before automated updates may be enabled. GitHub repository variables alone are not an independent trust anchor. Restrict the tag-publishing workflow and protect release credentials and tags. Signing credentials should be moved to a protected release environment or an external signing service when provisioned.

The release creates `AkariyaTenka.release.json` and `AkariyaTenka.release.sig`, verifies them against `AkariyaTenka.zip`, then publishes them alongside the ZIP/checksum and SBOM. No automatic install API or UI has been enabled in this phase. Run `node --test scripts/verify-release-files.test.mjs` to exercise the signing roundtrip.
