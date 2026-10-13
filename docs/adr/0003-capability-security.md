# ADR 0003: Capability-based assistant execution

- Status: Accepted
- Date: 2026-10-13

## Decision

Assistant tools declare capabilities and risk. Validated arguments pass through policy and, for mutating or dangerous operations, a single-use approval grant before execution. Security-relevant decisions are auditable.

The LLM itself never receives direct operating-system authority.
