export type Unsubscribe = () => void;
export type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<EventHandler<never>>>();

  constructor(private readonly onError: (event: keyof Events, error: unknown) => void = () => undefined) {}

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): Unsubscribe {
    const set = this.handlers.get(event) ?? new Set<EventHandler<never>>();
    set.add(handler as EventHandler<never>);
    this.handlers.set(event, set);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as EventHandler<never>);
    if (set.size === 0) this.handlers.delete(event);
  }

  async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try { await (handler as EventHandler<Events[K]>)(payload); }
      catch (error) { this.onError(event, error); }
    }
  }

  clear(): void { this.handlers.clear(); }
}
