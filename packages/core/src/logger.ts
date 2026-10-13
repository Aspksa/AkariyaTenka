import { SystemClock, type Clock } from "./clock.js";
import type { RequestContextScope } from "./context.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogEntry {
  readonly level: Exclude<LogLevel, "silent">;
  readonly scope: string;
  readonly message: string;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly data?: unknown;
}

export type LogSink = (entry: LogEntry) => void;
export type LogRedactor = (value: unknown) => unknown;

const order: Readonly<Record<LogLevel, number>> = {
  debug: 10, info: 20, warn: 30, error: 40, silent: 99
};

const consoleSink: LogSink = (entry) => {
  const suffix = entry.data === undefined ? "" : " " + JSON.stringify(entry.data);
  const correlation = entry.correlationId === undefined ? "" : " [" + entry.correlationId + "]";
  const line = entry.timestamp + " [" + entry.level + "] [" + entry.scope + "]" + correlation + " " + entry.message + suffix;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
};

export class Logger {
  constructor(
    private readonly scope = "akariya",
    private readonly level: LogLevel = "info",
    private readonly sinks: readonly LogSink[] = [consoleSink],
    private readonly redact: LogRedactor = (value) => value,
    private readonly clock: Clock = new SystemClock(),
    private readonly requestContext?: RequestContextScope
  ) {}

  child(scope: string): Logger {
    return new Logger(this.scope + ":" + scope, this.level, this.sinks, this.redact, this.clock, this.requestContext);
  }

  debug(message: string, data?: unknown): void { this.emit("debug", message, data); }
  info(message: string, data?: unknown): void { this.emit("info", message, data); }
  warn(message: string, data?: unknown): void { this.emit("warn", message, data); }
  error(message: string, data?: unknown): void { this.emit("error", message, data); }

  private emit(level: Exclude<LogLevel, "silent">, message: string, data?: unknown): void {
    if (order[level] < order[this.level]) return;
    const correlationId = this.requestContext?.current()?.correlationId;
    const entry: LogEntry = {
      level,
      scope: this.scope,
      message,
      timestamp: this.clock.now().toISOString(),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(data === undefined ? {} : { data: this.redact(data) })
    };
    for (const sink of this.sinks) {
      try { sink(entry); } catch { /* logging never breaks the app */ }
    }
  }
}
