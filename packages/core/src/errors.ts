export type AppErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PERMISSION"
  | "INTEGRITY"
  | "EXTERNAL_SERVICE"
  | "RATE_LIMIT"
  | "INTERNAL";

export interface AppErrorOptions {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly correlationId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly correlationId?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    if (options.correlationId !== undefined) this.correlationId = options.correlationId;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
