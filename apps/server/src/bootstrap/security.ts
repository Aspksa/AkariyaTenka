import type { Clock } from "@akariya/core";
import { ApprovalGate, DefaultSecurityPolicy, EnvironmentSecretStore } from "@akariya/security";
import type { AuditSink } from "@akariya/security";

export function createSecurity(audit: AuditSink, clock: Clock, env: NodeJS.ProcessEnv = process.env) {
  return {
    approvals: new ApprovalGate(audit, 120_000, clock),
    policy: new DefaultSecurityPolicy(),
    secrets: new EnvironmentSecretStore(env)
  };
}
