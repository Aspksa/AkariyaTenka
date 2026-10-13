import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { LifecycleAdapter, type Clock } from "@akariya/core";
import type { PerformanceResponse } from "@akariya/contracts";

const MAX_SAMPLES_PER_METRIC = 512;

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

export interface PerformanceSink {
  observe(name: string, valueMs: number): void;
}

export class PerformanceMetrics extends LifecycleAdapter implements PerformanceSink {
  private readonly samples = new Map<string, number[]>();
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });
  private started = false;

  constructor(private readonly clock: Clock) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.eventLoop.enable();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.eventLoop.disable();
    this.started = false;
  }

  observe(name: string, valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    const bucket = this.samples.get(name) ?? [];
    if (bucket.length === MAX_SAMPLES_PER_METRIC) bucket.shift();
    bucket.push(valueMs);
    this.samples.set(name, bucket);
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.observe(name, performance.now() - started);
    }
  }

  snapshot(correlationId: string): PerformanceResponse {
    const memory = process.memoryUsage();
    const metrics: PerformanceResponse["metrics"] = {};

    for (const [name, values] of this.samples.entries()) {
      metrics[name] = {
        count: values.length,
        p50Ms: percentile(values, 0.50),
        p95Ms: percentile(values, 0.95),
        p99Ms: percentile(values, 0.99),
        maxMs: values.length === 0 ? 0 : Math.max(...values)
      };
    }

    const toMilliseconds = (nanoseconds: number) => Number.isFinite(nanoseconds) ? nanoseconds / 1_000_000 : 0;
    return {
      timestamp: this.clock.now().toISOString(),
      correlationId,
      uptimeMs: process.uptime() * 1000,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal
      },
      eventLoop: {
        meanMs: toMilliseconds(this.eventLoop.mean),
        p95Ms: toMilliseconds(this.eventLoop.percentile(95)),
        maxMs: toMilliseconds(this.eventLoop.max)
      },
      metrics
    };
  }
}
