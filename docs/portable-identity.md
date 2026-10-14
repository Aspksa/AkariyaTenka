# Portable installation identity

The identity file `.akariya-installation.json` is a stable UUID for distinguishing one Akariya portable installation from another, regardless of SSD drive letter or computer name.

Before making the **first** SSD-to-computer copy on an installation that does not already have an identity, run on the stopped source:

```powershell
node scripts/portable-identity.mjs init "E:\AkariyaTenka"
```

Then use `portable-transfer.mjs copy`. The identity file travels with the copy. The `portable-sync.mjs plan` and `add` operations refuse to synchronize if only one copy has a marker or the identifiers differ. If both copies are legacy/unmarked, the existing conservative additive-only workflow remains possible, without an identity guarantee; create the marker on the canonical source *before* distributing new copies.

Never run `init` separately on home and work copies. Do not edit the identity file to bypass a mismatch; inspect and resolve the source lineage first. A matching UUID does **not** prove common ancestry or authorise overwriting modified data. Encrypted signing keys are not generated or managed by this identity mechanism. The actual publisher trust anchor is still unconfigured.
