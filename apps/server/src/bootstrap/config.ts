import path from "node:path";
import { z } from "zod";
import type { LogLevel } from "@akariya/core";

const portSchema = z.coerce.number().int().min(1).max(65535);
const envSchema = z.object({
  PORT: portSchema.optional(),
  AKARIYA_HOST: z.string().min(1).default("127.0.0.1"),
  AKARIYA_PORT: portSchema.default(4173),
  AKARIYA_DATA_DIR: z.string().min(1).default("./data"),
  AKARIYA_WEB_DIST: z.string().min(1).default("./apps/web/dist"),
  AKARIYA_LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  AKARIYA_SUPERVISED: z.enum(["0", "1"]).default("0")
});

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly webDist: string;
  readonly logLevel: LogLevel;
  readonly supervised: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    host: parsed.AKARIYA_HOST,
    port: parsed.PORT ?? parsed.AKARIYA_PORT,
    dataDir: path.resolve(cwd, parsed.AKARIYA_DATA_DIR),
    webDist: path.resolve(cwd, parsed.AKARIYA_WEB_DIST),
    logLevel: parsed.AKARIYA_LOG_LEVEL,
    supervised: parsed.AKARIYA_SUPERVISED === "1"
  };
}
