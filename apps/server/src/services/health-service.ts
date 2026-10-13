import type { ComponentHealth, Kernel } from "@akariya/core";
import type { HealthResponse } from "@akariya/contracts";

function overall(modules: Readonly<Record<string, ComponentHealth>>): HealthResponse["status"] {
  const values = Object.values(modules);
  if (values.some((item) => item.state === "failed" && !item.recoverable)) return "failed";
  if (values.some((item) => item.state !== "started")) return "degraded";
  return "healthy";
}

export class HealthService {
  constructor(private readonly kernel: Kernel) {}

  async snapshot(correlationId: string): Promise<HealthResponse> {
    const modules = await this.kernel.health();
    return { status: overall(modules), timestamp: new Date().toISOString(), correlationId, modules };
  }
}
