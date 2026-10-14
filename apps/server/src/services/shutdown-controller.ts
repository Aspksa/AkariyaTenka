import type { Logger } from "@akariya/core";

export interface ShutdownHooks {
  readonly closeHttp: () => Promise<void>;
  readonly stopRuntime: () => Promise<void>;
  readonly flushPersistence: () => Promise<void>;
}

export interface ShutdownRuntime {
  readonly setExitCode: (code: number) => void;
  readonly forceExit: (code: number) => void;
}

export interface ShutdownResult {
  readonly code: number;
  readonly failures: readonly string[];
}

export class ShutdownController {
  private active: Promise<ShutdownResult> | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly timeoutMs: number,
    private readonly hooks: ShutdownHooks,
    private readonly runtime: ShutdownRuntime = {
      setExitCode: (code) => { process.exitCode = code; },
      forceExit: (code) => process.exit(code)
    }
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("shutdown timeout must be a positive safe integer");
    }
  }

  shutdown(code: number, reason: string): Promise<ShutdownResult> {
    if (this.active !== undefined) return this.active;
    this.active = this.run(code, reason);
    return this.active;
  }

  private async run(requestedCode: number, reason: string): Promise<ShutdownResult> {
    this.logger.info("shutdown requested", { reason, requestedCode });
    const forcedCode = requestedCode === 0 || requestedCode === 76 ? 1 : requestedCode;
    const timer = setTimeout(() => {
      this.logger.error("shutdown timeout exceeded", { reason, timeoutMs: this.timeoutMs });
      this.runtime.forceExit(forcedCode);
    }, this.timeoutMs);

    const failures: string[] = [];
    for (const [name, operation] of [
      ["http", this.hooks.closeHttp],
      ["runtime", this.hooks.stopRuntime],
      ["persistence", this.hooks.flushPersistence]
    ] as const) {
      try {
        await operation();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(name + ": " + message);
        this.logger.error("shutdown step failed", { step: name, error: message });
      }
    }

    clearTimeout(timer);
    const code = failures.length > 0 && requestedCode === 0 ? 1 : requestedCode;
    this.runtime.setExitCode(code);
    return { code, failures };
  }
}
