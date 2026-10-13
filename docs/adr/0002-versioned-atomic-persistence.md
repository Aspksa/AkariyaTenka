# ADR 0002: Versioned atomic persistence by default

- Status: Accepted
- Date: 2026-10-13

## Decision

Critical JSON state uses atomic replacement, runtime validation, schema versions, explicit migrations and corruption quarantine. Direct ad-hoc state `writeFile()` calls are not allowed in domains.
