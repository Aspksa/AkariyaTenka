import { SystemClock, type Clock, type ComponentHealth, type Kernel } from "@akariya/core";
import type { HealthResponse } from "@akariya/contracts";

function overall(modules: Readonly<Record<string, ComponentHealth>>): HealthResponse["status"] {
  const values = Object.values(modules);
  if (values.some((item) => item.state === "failed" && !item.recoverable)) return "failed";
  if (values.some((item) => item.state !== "started")) return "degraded";
  return "healthy";
}

export class HealthService {
  constructor(
    private readonly kernel: Kernel,
    private readonly clock: Clock = new SystemClock()
  ) {}

  async snapshot(correlationId: string): Promise<HealthResponse> {
    const modules = await this.kernel.health();
    return { status: overall(modules), timestamp: this.clock.now().toISOString(), correlationId, modules };
  }
}
