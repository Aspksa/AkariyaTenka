export type HealthState = "started" | "degraded" | "failed";

export interface ComponentHealth {
  readonly state: HealthState;
  readonly lastSuccess?: string;
  readonly lastError?: string;
  readonly recoverable: boolean;
}

export interface Lifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
  health(): Promise<ComponentHealth>;
}

export abstract class LifecycleAdapter implements Lifecycle {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  async flush(): Promise<void> { return Promise.resolve(); }
  async health(): Promise<ComponentHealth> { return { state: "started", recoverable: true }; }
}
