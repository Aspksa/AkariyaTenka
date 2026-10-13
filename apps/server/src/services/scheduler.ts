import { LifecycleAdapter, type ComponentHealth } from "@akariya/core";

export interface ScheduledJobOptions {
  readonly name: string;
  readonly intervalMs: number;
  readonly maxRetries?: number;
  readonly backoffMs?: number;
  readonly run: (signal: AbortSignal) => Promise<void>;
}

interface JobState {
  readonly options: ScheduledJobOptions;
  timer?: NodeJS.Timeout;
  running: boolean;
  runs: number;
  failures: number;
  lastSuccess?: string;
  lastError?: string;
}

export class Scheduler extends LifecycleAdapter {
  private readonly jobs = new Map<string, JobState>();
  private controller = new AbortController();
  private started = false;

  register(options: ScheduledJobOptions): void {
    if (this.started) throw new Error("Cannot register scheduler jobs after start");
    if (this.jobs.has(options.name)) throw new Error("Duplicate scheduled job: " + options.name);
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) throw new Error("intervalMs must be positive");
    this.jobs.set(options.name, { options, running: false, runs: 0, failures: 0 });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.controller = new AbortController();
    for (const state of this.jobs.values()) {
      state.timer = setInterval(() => { void this.tick(state); }, state.options.intervalMs);
      state.timer.unref();
    }
  }

  async stop(): Promise<void> {
    this.controller.abort();
    for (const state of this.jobs.values()) if (state.timer) clearInterval(state.timer);
    await this.flush();
    this.started = false;
  }

  override async flush(): Promise<void> {
    while ([...this.jobs.values()].some((state) => state.running)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  override async health(): Promise<ComponentHealth> {
    const failed = [...this.jobs.values()].find((state) => state.lastError);
    return failed
      ? { state: "degraded", recoverable: true, ...(failed.lastSuccess ? { lastSuccess: failed.lastSuccess } : {}), ...(failed.lastError ? { lastError: failed.lastError } : {}) }
      : { state: "started", recoverable: true };
  }

  diagnostics(): readonly Readonly<Omit<JobState, "timer">>[] {
    return [...this.jobs.values()].map(({ timer: _timer, ...state }) => state);
  }

  private async tick(state: JobState): Promise<void> {
    if (state.running || this.controller.signal.aborted) return;
    state.running = true;
    const retries = state.options.maxRetries ?? 0;
    const backoff = state.options.backoffMs ?? 250;
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          await state.options.run(this.controller.signal);
          state.runs += 1;
          state.lastSuccess = new Date().toISOString();
          delete state.lastError;
          return;
        } catch (error) {
          state.failures += 1;
          state.lastError = error instanceof Error ? error.message : String(error);
          if (attempt >= retries || this.controller.signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, backoff * 2 ** attempt));
        }
      }
    } finally {
      state.running = false;
    }
  }
}
