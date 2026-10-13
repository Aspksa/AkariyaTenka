export const capabilities = [
  "read_local",
  "write_local",
  "delete_local",
  "network_read",
  "network_write",
  "external_write",
  "process_exec",
  "credential_access",
  "system_change"
] as const;

export type Capability = (typeof capabilities)[number];
export type Risk = "read" | "write" | "danger";

export interface PolicyInput {
  readonly capabilities: readonly Capability[];
  readonly risk: Risk;
}

export type PolicyDecision =
  | { readonly allowed: true; readonly approvalRequired: boolean }
  | { readonly allowed: false; readonly reason: string };

export interface SecurityPolicy {
  evaluate(input: PolicyInput): PolicyDecision;
}

export class DefaultSecurityPolicy implements SecurityPolicy {
  evaluate(input: PolicyInput): PolicyDecision {
    const privileged = input.capabilities.some((capability) => capability !== "read_local" && capability !== "network_read");
    return { allowed: true, approvalRequired: input.risk !== "read" || privileged };
  }
}
