export interface RequestContext {
  readonly correlationId: string;
  readonly actor: string;
}
