import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext, RequestContextScope } from "@akariya/core";

export class AsyncLocalRequestContextScope implements RequestContextScope {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  current(): RequestContext | undefined {
    return this.storage.getStore();
  }

  require(): RequestContext {
    const context = this.current();
    if (!context) throw new Error("Request context is not available");
    return context;
  }

  run<T>(context: RequestContext, operation: () => T): T {
    const snapshot: RequestContext = {
      correlationId: context.correlationId,
      actor: context.actor,
      ...(context.idempotencyKey === undefined ? {} : { idempotencyKey: context.idempotencyKey })
    };
    return this.storage.run(snapshot, operation);
  }
}
