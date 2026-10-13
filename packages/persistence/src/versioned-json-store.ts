import { z, type ZodType } from "zod";
import { AtomicJsonStore, type StoreRead } from "./atomic-json-store.js";
import { SerializedQueue } from "./serialized-queue.js";

export interface VersionedState<T> {
  readonly schemaVersion: number;
  readonly data: T;
}

export interface Migration {
  readonly from: number;
  readonly to: number;
  migrate(input: unknown): unknown;
}

export type VersionedRead<T> = StoreRead<VersionedState<T>> & { readonly migrated?: boolean };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class VersionedJsonStore<T> {
  private readonly envelopeSchema: ZodType<VersionedState<unknown>> = z.object({
    schemaVersion: z.number().int().nonnegative(),
    data: z.unknown()
  });
  private readonly raw: AtomicJsonStore<VersionedState<unknown>>;
  private readonly migrations = new Map<number, Migration>();
  private readonly queue = new SerializedQueue();

  constructor(
    filePath: string,
    private readonly currentVersion: number,
    private readonly dataSchema: ZodType<T>,
    migrations: readonly Migration[] = []
  ) {
    this.raw = new AtomicJsonStore(filePath, this.envelopeSchema);
    for (const migration of migrations) {
      if (migration.to !== migration.from + 1) throw new Error("Migrations must advance exactly one version");
      if (this.migrations.has(migration.from)) throw new Error("Duplicate migration from v" + migration.from);
      this.migrations.set(migration.from, migration);
    }
  }

  read(): Promise<VersionedRead<T>> {
    return this.queue.run(async () => {
      const result = await this.raw.read();
      if (result.status !== "ok") return result;

      let version = result.value.schemaVersion;
      if (version > this.currentVersion) {
        throw new Error("State v" + version + " is newer than supported v" + this.currentVersion);
      }

      let data: unknown = result.value.data;
      const migrated = version !== this.currentVersion;

      try {
        while (version < this.currentVersion) {
          const migration = this.migrations.get(version);
          if (!migration) throw new Error("Missing migration v" + version + " -> v" + (version + 1));
          data = migration.migrate(data);
          version = migration.to;
        }
        const safe = this.dataSchema.parse(data);
        const value: VersionedState<T> = { schemaVersion: this.currentVersion, data: safe };
        if (migrated) await this.raw.write(value);
        return { status: "ok", value, ...(migrated ? { migrated: true } : {}) };
      } catch (error) {
        const quarantinePath = await this.raw.quarantine();
        return { status: "degraded", quarantinePath, error: asError(error) };
      }
    });
  }

  write(data: T): Promise<void> {
    const safe = this.dataSchema.parse(data);
    return this.queue.run(() => this.raw.write({ schemaVersion: this.currentVersion, data: safe }));
  }

  async flush(): Promise<void> {
    await this.queue.idle();
    await this.raw.flush();
  }
}
