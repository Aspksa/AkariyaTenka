import { z, type ZodType } from "zod";
import { AtomicJsonStore } from "./atomic-json-store.js";
import { SerializedQueue } from "./serialized-queue.js";

export interface IdempotencyRecord<T> {
  readonly key: string;
  readonly createdAt: string;
  readonly value: T;
}

export interface PutIdempotencyResult<T> {
  readonly inserted: boolean;
  readonly record: IdempotencyRecord<T>;
}

const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

export class FileIdempotencyStore<T> {
  private readonly queue = new SerializedQueue();
  private readonly store: AtomicJsonStore<{
    readonly schemaVersion: 1;
    readonly entries: Readonly<Record<string, { readonly createdAt: string; readonly value: T }>>;
  }>;

  constructor(filePath: string, valueSchema: ZodType<T>) {
    const entrySchema = z.object({
      createdAt: z.string().datetime(),
      value: valueSchema
    });
    const stateSchema = z.object({
      schemaVersion: z.literal(1),
      entries: z.record(z.string(), entrySchema)
    });
    this.store = new AtomicJsonStore(filePath, stateSchema);
  }

  get(key: string): Promise<IdempotencyRecord<T> | null> {
    this.assertKey(key);
    return this.queue.run(async () => {
      const state = await this.readState();
      const entry = state.entries[key];
      return entry ? { key, createdAt: entry.createdAt, value: structuredClone(entry.value) } : null;
    });
  }

  putIfAbsent(record: IdempotencyRecord<T>): Promise<PutIdempotencyResult<T>> {
    this.assertKey(record.key);
    return this.queue.run(async () => {
      const state = await this.readState();
      const existing = state.entries[record.key];
      if (existing) {
        return {
          inserted: false,
          record: { key: record.key, createdAt: existing.createdAt, value: structuredClone(existing.value) }
        };
      }

      const next = {
        schemaVersion: 1 as const,
        entries: {
          ...state.entries,
          [record.key]: { createdAt: record.createdAt, value: structuredClone(record.value) }
        }
      };
      await this.store.write(next);
      return { inserted: true, record: structuredClone(record) };
    });
  }

  delete(key: string): Promise<boolean> {
    this.assertKey(key);
    return this.queue.run(async () => {
      const state = await this.readState();
      if (!(key in state.entries)) return false;
      const entries = { ...state.entries };
      delete entries[key];
      await this.store.write({ schemaVersion: 1, entries });
      return true;
    });
  }

  async flush(): Promise<void> {
    await this.queue.idle();
    await this.store.flush();
  }

  private assertKey(key: string): void {
    if (!keyPattern.test(key)) throw new Error("Invalid idempotency key");
  }

  private async readState(): Promise<{
    readonly schemaVersion: 1;
    readonly entries: Readonly<Record<string, { readonly createdAt: string; readonly value: T }>>;
  }> {
    const result = await this.store.read();
    if (result.status === "missing") return { schemaVersion: 1, entries: {} };
    if (result.status === "degraded") {
      throw new Error("Idempotency state is degraded; refusing to risk duplicate side effects");
    }
    return result.value;
  }
}
