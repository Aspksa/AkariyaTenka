# Akariya Tenka

Akariya Tenka is a new, independent application foundation inspired by the strongest engineering lessons from JUUNIBI while deliberately avoiding accumulated coupling and oversized modules.

## First working milestone

- npm workspaces monorepo
- strict TypeScript
- Zod runtime validation
- versioned atomic persistence and corruption quarantine
- capability-based security and single-use approvals
- centralized tool registry
- correlation-aware audit contracts
- typed configuration loaded once at bootstrap
- lifecycle, scheduler, health and network foundations
- modular server and web shell
- Linux + Windows CI

## Requirements

Node.js 20+ and npm 10+.

## Development

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite server proxies `/api` to the backend.

## Quality gate

```bash
npm run check
```

Equivalent to typecheck, tests and build.

## Production-style local start

```bash
npm run build
npm start
```

Open `http://127.0.0.1:4173`.

`GET /api/health` returns the runtime health report.

See `docs/architecture.md`, `docs/security-model.md`, `docs/persistence.md` and `docs/development.md` before adding a domain.

GitHub version checks are available in the dashboard (see [GitHub update detection](docs/github-update-check.md)). They do not automatically install or execute upstream changes.
