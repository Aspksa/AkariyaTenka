import path from "node:path";
import { z } from "zod";
import type { LogLevel } from "@akariya/core";

const portSchema = z.coerce.number().int().min(1).max(65535);
const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();

const envSchema = z.object({
  PORT: portSchema.optional(),
  AKARIYA_HOST: z.string().min(1).default("127.0.0.1"),
  AKARIYA_PORT: portSchema.default(4173),
  AKARIYA_DATA_DIR: z.string().min(1).default("./data"),
  AKARIYA_WEB_DIST: z.string().min(1).default("./apps/web/dist"),
  AKARIYA_LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  AKARIYA_SUPERVISED: z.enum(["0", "1"]).default("0"),
  AKARIYA_SUPERVISOR_TOKEN: z.string().min(32).max(256).optional(),
  AKARIYA_IDEMPOTENCY_TTL_HOURS: positiveInteger.default(168),
  AKARIYA_IDEMPOTENCY_MAX_ENTRIES: positiveInteger.default(10000),
  AKARIYA_AUDIT_MAX_BYTES: positiveInteger.default(10 * 1024 * 1024),
  AKARIYA_AUDIT_MAX_ARCHIVES: nonNegativeInteger.default(5),
  AKARIYA_SHUTDOWN_TIMEOUT_MS: positiveInteger.default(10000)
});

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly webDist: string;
  readonly logLevel: LogLevel;
  readonly supervised: boolean;
  readonly supervisorToken?: string;
  readonly idempotencyTtlMs: number;
  readonly idempotencyMaxEntries: number;
  readonly auditMaxBytes: number;
  readonly auditMaxArchives: number;
  readonly shutdownTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    host: parsed.AKARIYA_HOST,
    port: parsed.PORT ?? parsed.AKARIYA_PORT,
    dataDir: path.resolve(cwd, parsed.AKARIYA_DATA_DIR),
    webDist: path.resolve(cwd, parsed.AKARIYA_WEB_DIST),
    logLevel: parsed.AKARIYA_LOG_LEVEL,
    supervised: parsed.AKARIYA_SUPERVISED === "1",
    ...(parsed.AKARIYA_SUPERVISOR_TOKEN === undefined ? {} : { supervisorToken: parsed.AKARIYA_SUPERVISOR_TOKEN }),
    idempotencyTtlMs: parsed.AKARIYA_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
    idempotencyMaxEntries: parsed.AKARIYA_IDEMPOTENCY_MAX_ENTRIES,
    auditMaxBytes: parsed.AKARIYA_AUDIT_MAX_BYTES,
    auditMaxArchives: parsed.AKARIYA_AUDIT_MAX_ARCHIVES,
    shutdownTimeoutMs: parsed.AKARIYA_SHUTDOWN_TIMEOUT_MS
  };
}
