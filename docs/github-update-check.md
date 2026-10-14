# GitHub update detection

Akariya Tenka checks the latest commit on the official
[Aspksa/AkariyaTenka](https://github.com/Aspksa/AkariyaTenka) `main` branch
using GitHub's HTTPS API. The dashboard **Обновления GitHub** compares that
revision with the installed `.akariya-version` marker or, for source checkouts,
the local Git HEAD.

The check is read-only. It never executes downloaded code, never writes to
the installed application, never reads secret data and never requires an
external publisher key. Results display the GitHub revision, local revision
and a link to inspect the differences.

**Installation is not yet implemented.** A mismatch only means that the
revisions differ, not that a particular release is safe to install or is
necessarily a descendant of the current version. ZIP installations need a
trusted, immutable release artifact; a validated manifest, complete staging,
backup/rollback and a supervised restart before any automatic deployment can
be enabled. Do not replace files while the application is running.
