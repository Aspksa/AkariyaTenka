import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FileIdempotencyStore } from "@akariya/persistence";
import type { AppConfig } from "./config.js";
import { FileAuditSink } from "../adapters/file-audit-sink.js";

const idempotencyValueSchema = z.object({
  operation: z.string().min(1),
  result: z.unknown()
});

export type IdempotencyValue = z.infer<typeof idempotencyValueSchema>;

export async function createStorage(config: AppConfig): Promise<{
  audit: FileAuditSink;
  idempotency: FileIdempotencyStore<IdempotencyValue>;
}> {
  await mkdir(config.dataDir, { recursive: true });
  return {
    audit: new FileAuditSink(
      path.join(config.dataDir, "audit.jsonl"),
      config.auditMaxBytes,
      config.auditMaxArchives
    ),
    idempotency: new FileIdempotencyStore(
      path.join(config.dataDir, "idempotency.json"),
      idempotencyValueSchema,
      {
        ttlMs: config.idempotencyTtlMs,
        maxEntries: config.idempotencyMaxEntries
      }
    )
  };
}
