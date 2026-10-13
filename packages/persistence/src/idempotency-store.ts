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

export interface IdempotencyRetentionOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly nowMs?: () => number;
}

export interface IdempotencyProbe {
  readonly status: "ok" | "degraded";
  readonly entries: number;
  readonly lastError?: string;
}

const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const fingerprintPattern = /^[0-9a-f]{64}$/u;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

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

interface StoredEntry<T> {
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly value: T;
}

interface StoredState<T> {
  readonly schemaVersion: 1;
  readonly entries: Readonly<Record<string, StoredEntry<T>>>;
}

export class FileIdempotencyStore<T> {
  private readonly queue = new SerializedQueue();
  private readonly store: AtomicJsonStore<StoredState<T>>;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowMs: () => number;
  private lastError: string | undefined;

  constructor(filePath: string, valueSchema: ZodType<T>, options: IdempotencyRetentionOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.nowMs = options.nowMs ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) throw new Error("Idempotency ttlMs must be a positive safe integer");
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new Error("Idempotency maxEntries must be a positive safe integer");

    const entrySchema = z.object({
      fingerprint: z.string().regex(fingerprintPattern),
      createdAt: z.string().datetime(),
      value: valueSchema
    });
    const stateSchema: ZodType<StoredState<T>> = z.object({
      schemaVersion: z.literal(1),
      entries: z.record(z.string(), entrySchema)
    });
    this.store = new AtomicJsonStore(filePath, stateSchema);
  }

  get(key: string): Promise<IdempotencyRecord<T> | null> {
    this.assertKey(key);
    return this.queue.run(async () => {
      const state = await this.compactedState();
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
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs)) throw new Error("Invalid idempotency timestamp");
    if (this.nowMs() - createdAtMs > this.ttlMs) throw new Error("Idempotency timestamp is already outside the retention window");

    return this.queue.run(async () => {
      const state = await this.compactedState();
      const existing = state.entries[key];
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError(key);
        return { replayed: true, record: this.toRecord(key, existing) };
      }

      const value = await operation();
      const nextEntries = {
        ...state.entries,
        [key]: {
          fingerprint,
          createdAt,
          value: structuredClone(value)
        }
      };
      const next = this.compact({ schemaVersion: 1, entries: nextEntries });
      await this.writeState(next);
      const stored = next.entries[key];
      if (stored === undefined) throw new Error("Idempotency retention unexpectedly removed the current operation");
      return {
        replayed: false,
        record: this.toRecord(key, stored)
      };
    });
  }

  delete(key: string): Promise<boolean> {
    this.assertKey(key);
    return this.queue.run(async () => {
      const state = await this.compactedState();
      if (!(key in state.entries)) return false;
      const entries = { ...state.entries };
      delete entries[key];
      await this.writeState({ schemaVersion: 1, entries });
      return true;
    });
  }

  probe(): Promise<IdempotencyProbe> {
    return this.queue.run(async () => {
      try {
        const state = await this.compactedState();
        return this.lastError === undefined
          ? { status: "ok", entries: Object.keys(state.entries).length }
          : { status: "degraded", entries: Object.keys(state.entries).length, lastError: this.lastError };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        return { status: "degraded", entries: 0, lastError: message };
      }
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

  private toRecord(key: string, entry: StoredEntry<T>): IdempotencyRecord<T> {
    return {
      key,
      fingerprint: entry.fingerprint,
      createdAt: entry.createdAt,
      value: structuredClone(entry.value)
    };
  }

  private async compactedState(): Promise<StoredState<T>> {
    const state = await this.readState();
    const compacted = this.compact(state);
    if (Object.keys(compacted.entries).length !== Object.keys(state.entries).length) {
      await this.writeState(compacted);
    }
    return compacted;
  }

  private compact(state: StoredState<T>): StoredState<T> {
    const now = this.nowMs();
    const retained = Object.entries(state.entries)
      .filter(([, entry]) => now - Date.parse(entry.createdAt) <= this.ttlMs)
      .sort((left, right) => Date.parse(right[1].createdAt) - Date.parse(left[1].createdAt))
      .slice(0, this.maxEntries);
    return { schemaVersion: 1, entries: Object.fromEntries(retained) };
  }

  private async readState(): Promise<StoredState<T>> {
    const result = await this.store.read();
    if (result.status === "missing") return { schemaVersion: 1, entries: {} };
    if (result.status === "degraded") {
      this.lastError = "Idempotency state is degraded; refusing to risk duplicate side effects";
      throw new Error(this.lastError);
    }
    return result.value;
  }

  private async writeState(state: StoredState<T>): Promise<void> {
    await this.store.write(state);
    this.lastError = undefined;
  }
}
