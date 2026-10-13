import { SystemClock, type Clock, type ComponentHealth, type Kernel } from "@akariya/core";
import type { HealthResponse } from "@akariya/contracts";

export type HealthContributor = () => ComponentHealth | Promise<ComponentHealth>;

function overall(modules: Readonly<Record<string, ComponentHealth>>): HealthResponse["status"] {
  const values = Object.values(modules);
  if (values.some((item) => item.state === "failed" && !item.recoverable)) return "failed";
  if (values.some((item) => item.state !== "started")) return "degraded";
  return "healthy";
}

export class HealthService {
  constructor(
    private readonly kernel: Kernel,
    private readonly clock: Clock = new SystemClock(),
    private readonly contributors: Readonly<Record<string, HealthContributor>> = {}
  ) {}

  async snapshot(correlationId: string): Promise<HealthResponse> {
    const kernelModules = await this.kernel.health();
    const contributorEntries = await Promise.all(
      Object.entries(this.contributors).map(async ([name, contributor]) => {
        try {
          return [name, await contributor()] as const;
        } catch (error) {
          return [name, {
            state: "failed" as const,
            recoverable: true,
            lastError: error instanceof Error ? error.message : String(error)
          }] as const;
        }
      })
    );
    const modules = { ...kernelModules, ...Object.fromEntries(contributorEntries) };
    return { status: overall(modules), timestamp: this.clock.now().toISOString(), correlationId, modules };
  }
}
