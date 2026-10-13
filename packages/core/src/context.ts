export interface RequestContext {
  readonly correlationId: string;
  readonly actor: string;
  readonly idempotencyKey?: string;
}

export interface RequestContextScope {
  current(): RequestContext | undefined;
  require(): RequestContext;
  run<T>(context: RequestContext, operation: () => T): T;
}
