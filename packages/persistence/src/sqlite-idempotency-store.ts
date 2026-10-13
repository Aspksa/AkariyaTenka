import type { ZodType } from "zod";
import {
  IdempotencyConflictError,
  type IdempotencyExecution,
  type IdempotencyProbe,
  type IdempotencyRecord,
  type IdempotencyStore
} from "./idempotency-store.js";
import { SerializedQueue } from "./serialized-queue.js";

type SqlValue = string | number | bigint | Uint8Array | null;
type Row = Readonly<Record<string, SqlValue>>;

interface StatementLike {
  get(...params: readonly SqlValue[]): Row | undefined;
  run(...params: readonly SqlValue[]): { readonly changes: number | bigint };
}

interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
}

interface SqliteModuleLike {
  readonly DatabaseSync: new (filePath: string) => DatabaseLike;
}

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

export interface SqliteIdempotencyOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly nowMs?: () => number;
}

export class SqliteIdempotencyStore<T> implements IdempotencyStore<T> {
  private readonly queue = new SerializedQueue();
  private lastError: string | undefined;

  private constructor(
    private readonly db: DatabaseLike,
    private readonly valueSchema: ZodType<T>,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly nowMs: () => number
  ) {}

  static async open<T>(
    filePath: string,
    valueSchema: ZodType<T>,
    options: SqliteIdempotencyOptions = {}
  ): Promise<SqliteIdempotencyStore<T>> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const nowMs = options.nowMs ?? Date.now;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Idempotency ttlMs must be a positive safe integer");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("Idempotency maxEntries must be a positive safe integer");

    const specifier = "node:sqlite";
    const sqlite = await import(specifier) as unknown as SqliteModuleLike;
    const db = new sqlite.DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA synchronous=NORMAL;");
    db.exec("PRAGMA busy_timeout=5000;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        value_json TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idempotency_created_at_idx
        ON idempotency(created_at_ms);
    `);

    const store = new SqliteIdempotencyStore(db, valueSchema, ttlMs, maxEntries, nowMs);
    await store.queue.run(async () => { store.compact(); });
    return store;
  }

  get(key: string): Promise<IdempotencyRecord<T> | null> {
    this.assertKey(key);
    return this.queue.run(async () => {
      this.compact();
      const row = this.db.prepare(
        "SELECT key, fingerprint, created_at, value_json FROM idempotency WHERE key = ?"
      ).get(key);
      return row === undefined ? null : this.rowToRecord(row);
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
    if (this.nowMs() - createdAtMs > this.ttlMs) {
      throw new Error("Idempotency timestamp is already outside the retention window");
    }

    return this.queue.run(async () => {
      this.compact();
      const existing = this.db.prepare(
        "SELECT key, fingerprint, created_at, value_json FROM idempotency WHERE key = ?"
      ).get(key);
      if (existing !== undefined) {
        const record = this.rowToRecord(existing);
        if (record.fingerprint !== fingerprint) throw new IdempotencyConflictError(key);
        return { replayed: true, record };
      }

      const value = this.valueSchema.parse(await operation());
      this.db.prepare(
        "INSERT INTO idempotency(key, fingerprint, created_at, created_at_ms, value_json) VALUES (?, ?, ?, ?, ?)"
      ).run(key, fingerprint, createdAt, createdAtMs, JSON.stringify(value));
      this.compact();

      const stored = this.db.prepare(
        "SELECT key, fingerprint, created_at, value_json FROM idempotency WHERE key = ?"
      ).get(key);
      if (stored === undefined) throw new Error("Idempotency retention unexpectedly removed the current operation");
      this.lastError = undefined;
      return { replayed: false, record: this.rowToRecord(stored) };
    });
  }

  delete(key: string): Promise<boolean> {
    this.assertKey(key);
    return this.queue.run(async () => {
      const result = this.db.prepare("DELETE FROM idempotency WHERE key = ?").run(key);
      return Number(result.changes) > 0;
    });
  }

  probe(): Promise<IdempotencyProbe> {
    return this.queue.run(async () => {
      try {
        this.compact();
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM idempotency").get();
        const mode = this.db.prepare("PRAGMA journal_mode").get();
        const entries = Number(count?.count ?? 0);
        const journalMode = String(mode?.journal_mode ?? "").toLowerCase();
        if (journalMode !== "wal") {
          this.lastError = "SQLite journal_mode is not WAL";
          return { status: "degraded", entries, backend: "sqlite-wal", lastError: this.lastError };
        }
        this.lastError = undefined;
        return { status: "ok", entries, backend: "sqlite-wal" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        return { status: "degraded", entries: 0, backend: "sqlite-wal", lastError: message };
      }
    });
  }

  async flush(): Promise<void> {
    await this.queue.idle();
    await this.queue.run(async () => {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    });
  }

  async close(): Promise<void> {
    await this.queue.idle();
    await this.queue.run(async () => {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      this.db.close();
    });
  }

  private compact(): void {
    const cutoff = this.nowMs() - this.ttlMs;
    this.db.prepare("DELETE FROM idempotency WHERE created_at_ms < ?").run(cutoff);

    const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM idempotency").get()?.count ?? 0);
    const excess = count - this.maxEntries;
    if (excess > 0) {
      this.db.prepare(
        "DELETE FROM idempotency WHERE key IN (SELECT key FROM idempotency ORDER BY created_at_ms ASC, key ASC LIMIT ?)"
      ).run(excess);
    }
  }

  private rowToRecord(row: Row): IdempotencyRecord<T> {
    const key = String(row.key);
    const fingerprint = String(row.fingerprint);
    const createdAt = String(row.created_at);
    const raw = String(row.value_json);
    const parsed: unknown = JSON.parse(raw);
    return {
      key,
      fingerprint,
      createdAt,
      value: this.valueSchema.parse(parsed)
    };
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid idempotency key");
  }

  private assertFingerprint(fingerprint: string): void {
    if (!FINGERPRINT_PATTERN.test(fingerprint)) throw new Error("Invalid idempotency fingerprint");
  }
}
