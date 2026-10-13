# ADR 0001: Modular npm workspaces monorepo

- Status: Accepted
- Date: 2026-10-13

## Context

JUUNIBI demonstrated useful shared-core and workspace patterns but also accumulated very large server files and tightly coordinated concerns.

## Decision

Akariya Tenka starts as an npm workspaces monorepo with explicit package ownership. The composition root lives in `apps/server`; reusable policy and infrastructure contracts live in packages.

## Consequences

The project accepts more boundaries up front in exchange for safer independent evolution and clearer testing.
