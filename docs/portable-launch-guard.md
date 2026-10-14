# Launcher preflight and portable synchronization locks

The Akariya launcher checks `.portable-state/sync.lock` before applying prepared updates and again immediately before starting its backend. If a lock exists, startup fails without ignoring the lock. An invalid `.portable-state` path also fails closed. This protects a **new launcher invocation** against an already-running cooperative portable-sync operation, and prevents applying updates while a lock is present.

The `portable-sync.mjs add` operation obtains cooperative locks on both copies. **Important limitation:** the launcher does not yet hold a lock for its entire lifespan, so this is NOT a guarantee that a new synchronization cannot begin while an existing Akariya process is running. There remains a time-of-check/time-of-use race. Always completely shut down Akariya and any editors before invoking sync; `--both-stopped` only records the operator's acknowledgement.

If startup says a synchronization lock exists, stop any active transfer and inspect the lock before manually clearing it. Do not automatically delete a lock based on its age.

Next work: shared lifecycle arbitration between launcher and sync, plus backups/verified rollback before enabling modified-file replacement. The current synchronization command still only adds files and refuses conflicts.

Publisher private signing material is not transferred or enabled by this change.
