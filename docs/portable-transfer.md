# Portable Transfer Foundation — first safe step

Akariya Tenka may run directly on an external SSD or from a **separate local copy**. This phase introduces a cautious CLI to create a new verified portable copy and compare two existing copies before any overwrite is considered.

Run **only after closing Akariya and the launcher on both locations**, ensuring databases are flushed. Close any editors or tools that may write into source files.

- Create a new local copy: `node scripts/portable-transfer.mjs copy "E:\\AkariyaTenka" "C:\\AkariyaTenka"` — destination **must not exist**.
- Compare existing copies: `node scripts/portable-transfer.mjs compare "C:\\AkariyaTenka" "E:\\AkariyaTenka"`.
- Reverse direction for moving back to SSD, but **never overwrite an existing SSD copy** through this tool. It reports changed, source-only and destination-only paths; conflicts must be resolved separately.
- The script validates SHA-256 of each copied file and stages within the destination parent before renaming. It refuses nested destinations, symlinks/junctions encountered in selected tree entries, and publisher private signing material.
- It excludes `.git` and `node_modules`, which are developer state/dependencies rather than portable application data. `.runtime`, `.updates`, `.env`, `data`, built assets, configuration and app-controlled model files are included. If `node_modules` is needed in a source checkout, use the existing launcher to reconstruct dependencies.

**Current limitation:** This tool does **not** implement automatic bidirectional merging or replace an existing working directory. It is intentionally fail-closed. Direct-SSD execution continues to use the ordinary `AKARIYA.bat`; no copy needed. A future transfer manager should add quiescence/locking, ancestry tracking, conflict resolution, transactional backups, and a stable desktop UI before any overwrite workflow is enabled. Save important backups on a second physical device.

Publisher signing key: `publisher-private.pem` must be created once on a trusted owner-controlled device separate from project SSD and local copies, held in protected GitHub Actions secret or external signer, and never copied along with the project. Public key/fingerprint may accompany a trusted build, but the existing embedded trust anchor is still **unconfigured**, so signed release installation remains blocked.
