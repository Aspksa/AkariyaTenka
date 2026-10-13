import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FileIdempotencyStore,
  SqliteIdempotencyStore,
  type IdempotencyStore
} from "@akariya/persistence";
import type { AppConfig } from "./config.js";
import { FileAuditSink } from "../adapters/file-audit-sink.js";

const idempotencyValueSchema = z.object({
  operation: z.string().min(1),
  result: z.unknown()
});

export type IdempotencyValue = z.infer<typeof idempotencyValueSchema>;

export interface RuntimeStorage {
  readonly audit: FileAuditSink;
  readonly idempotency: IdempotencyStore<IdempotencyValue>;
  readonly idempotencyBackend: "json" | "sqlite-wal";
}

export async function createStorage(config: AppConfig): Promise<RuntimeStorage> {
  await mkdir(config.dataDir, { recursive: true });
  const options = {
    ttlMs: config.idempotencyTtlMs,
    maxEntries: config.idempotencyMaxEntries
  };

  const major = Number(process.versions.node.split(".")[0]);
  const idempotency = Number.isInteger(major) && major >= 22
    ? await SqliteIdempotencyStore.open(
        path.join(config.dataDir, "runtime.sqlite"),
        idempotencyValueSchema,
        options
      )
    : new FileIdempotencyStore(
        path.join(config.dataDir, "idempotency.json"),
        idempotencyValueSchema,
        options
      );

  return {
    audit: new FileAuditSink(
      path.join(config.dataDir, "audit.jsonl"),
      config.auditMaxBytes,
      config.auditMaxArchives
    ),
    idempotency,
    idempotencyBackend: major >= 22 ? "sqlite-wal" : "json"
  };
}
