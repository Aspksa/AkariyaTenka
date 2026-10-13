import type { ComponentHealth, Lifecycle } from "./lifecycle.js";

export interface KernelRegistration {
  readonly name: string;
  readonly dependencies?: readonly string[];
  readonly service: Lifecycle;
}

export class Kernel {
  private readonly registrations = new Map<string, KernelRegistration>();
  private startedOrder: KernelRegistration[] = [];

  register(registration: KernelRegistration): void {
    if (this.registrations.has(registration.name)) throw new Error("Duplicate lifecycle component: " + registration.name);
    this.registrations.set(registration.name, registration);
  }

  async start(): Promise<void> {
    const ordered = this.order();
    const started: KernelRegistration[] = [];
    try {
      for (const registration of ordered) {
        await registration.service.start();
        started.push(registration);
      }
      this.startedOrder = started;
    } catch (error) {
      for (const registration of [...started].reverse()) await registration.service.stop().catch(() => undefined);
      throw error;
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.startedOrder.map(({ service }) => service.flush()));
  }

  async stop(): Promise<void> {
    await this.flush();
    for (const registration of [...this.startedOrder].reverse()) await registration.service.stop().catch(() => undefined);
    this.startedOrder = [];
  }

  async health(): Promise<Readonly<Record<string, ComponentHealth>>> {
    const entries = await Promise.all(
      [...this.registrations.entries()].map(async ([name, registration]) => [name, await registration.service.health()] as const)
    );
    return Object.fromEntries(entries);
  }

  private order(): KernelRegistration[] {
    const ordered: KernelRegistration[] = [];
    const state = new Map<string, "visiting" | "visited">();
    const visit = (name: string, chain: readonly string[]): void => {
      const registration = this.registrations.get(name);
      if (!registration) throw new Error("Missing lifecycle dependency: " + name);
      if (state.get(name) === "visited") return;
      if (state.get(name) === "visiting") throw new Error("Lifecycle dependency cycle: " + [...chain, name].join(" -> "));
      state.set(name, "visiting");
      for (const dependency of registration.dependencies ?? []) visit(dependency, [...chain, name]);
      state.set(name, "visited");
      ordered.push(registration);
    };
    for (const name of this.registrations.keys()) visit(name, []);
    return ordered;
  }
}
