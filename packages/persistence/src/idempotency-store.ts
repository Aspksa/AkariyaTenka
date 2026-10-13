import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";
import { AtomicJsonStore } from "./atomic-json-store.js";
import { SerializedQueue } from "./serialized-queue.js";

export interface IdempotencyRecord<T> {
  readonly key: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly value: T;
}

export interface IdempotencyExecution<T> {
  readonly replayed: boolean;
  readonly record: IdempotencyRecord<T>;
}

const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const fingerprintPattern = /^[0-9a-f]{64}$/u;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(record[key])).join(",") + "}";
}

export function idempotencyFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export class IdempotencyConflictError extends Error {
  constructor(readonly key: string) {
    super("Idempotency key was already used with different arguments");
    this.name = "IdempotencyConflictError";
  }
}

export class FileIdempotencyStore<T> {
  private readonly queue = new SerializedQueue();
  private readonly store: AtomicJsonStore<{
    readonly schemaVersion: 1;
    readonly entries: Readonly<Record<string, {
      readonly fingerprint: string;
      readonly createdAt: string;
      readonly value: T;
    }>>;
  }>;

  constructor(filePath: string, valueSchema: ZodType<T>) {
    const entrySchema = z.object({
      fingerprint: z.string().regex(fingerprintPattern),
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
      return entry === undefined ? null : this.toRecord(key, entry);
    });
  }

  executeOnce(
    key: string,
    fingerprint: string,
    createdAt: string,
    operation: () => Promise<T>
  ): Promise<IdempotencyExecution<T>> {
    this.assertKey(key);
    this.assertFingerprint(fingerprint);
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid idempotency timestamp");

    return this.queue.run(async () => {
      const state = await this.readState();
      const existing = state.entries[key];
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError(key);
        return { replayed: true, record: this.toRecord(key, existing) };
      }

      const value = await operation();
      const next = {
        schemaVersion: 1 as const,
        entries: {
          ...state.entries,
          [key]: {
            fingerprint,
            createdAt,
            value: structuredClone(value)
          }
        }
      };
      await this.store.write(next);
      return {
        replayed: false,
        record: { key, fingerprint, createdAt, value: structuredClone(value) }
      };
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

  private assertFingerprint(fingerprint: string): void {
    if (!fingerprintPattern.test(fingerprint)) throw new Error("Invalid idempotency fingerprint");
  }

  private toRecord(
    key: string,
    entry: { readonly fingerprint: string; readonly createdAt: string; readonly value: T }
  ): IdempotencyRecord<T> {
    return {
      key,
      fingerprint: entry.fingerprint,
      createdAt: entry.createdAt,
      value: structuredClone(entry.value)
    };
  }

  private async readState(): Promise<{
    readonly schemaVersion: 1;
    readonly entries: Readonly<Record<string, {
      readonly fingerprint: string;
      readonly createdAt: string;
      readonly value: T;
    }>>;
  }> {
    const result = await this.store.read();
    if (result.status === "missing") return { schemaVersion: 1, entries: {} };
    if (result.status === "degraded") {
      throw new Error("Idempotency state is degraded; refusing to risk duplicate side effects");
    }
    return result.value;
  }
}
