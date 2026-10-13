import { ApprovalGate, DefaultSecurityPolicy, InMemorySecretStore } from "@akariya/security";
import type { AuditSink } from "@akariya/security";

export function createSecurity(audit: AuditSink) {
  return {
    approvals: new ApprovalGate(audit),
    policy: new DefaultSecurityPolicy(),
    secrets: new InMemorySecretStore()
  };
}
