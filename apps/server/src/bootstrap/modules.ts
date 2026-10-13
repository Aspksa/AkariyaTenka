import { Kernel, LifecycleAdapter, type Clock } from "@akariya/core";
import { Scheduler } from "../services/scheduler.js";
import { NetworkClient } from "../services/network-client.js";

class RuntimeMarker extends LifecycleAdapter {
  private started = false;
  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }
  override async health() {
    return { state: this.started ? "started" as const : "failed" as const, recoverable: true };
  }
}

export function createModules(clock: Clock) {
  const kernel = new Kernel();
  const scheduler = new Scheduler(clock);
  const network = new NetworkClient();
  kernel.register({ name: "runtime", service: new RuntimeMarker() });
  kernel.register({ name: "scheduler", dependencies: ["runtime"], service: scheduler });
  return { kernel, scheduler, network };
}
