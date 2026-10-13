import type { HealthResponse } from "@akariya/contracts";

export type HealthState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly health: HealthResponse }
  | { readonly kind: "error"; readonly message: string };

export class HealthStore {
  private state: HealthState = { kind: "loading" };
  private readonly listeners = new Set<(state: HealthState) => void>();

  get(): HealthState { return this.state; }

  set(state: HealthState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  subscribe(listener: (state: HealthState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
