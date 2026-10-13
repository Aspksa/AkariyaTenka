import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { FileAuditSink } from "../adapters/file-audit-sink.js";

export async function createStorage(config: AppConfig): Promise<{ audit: FileAuditSink }> {
  await mkdir(config.dataDir, { recursive: true });
  return { audit: new FileAuditSink(path.join(config.dataDir, "audit.jsonl")) };
}
