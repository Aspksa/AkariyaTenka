# Development

Setup: `npm ci`, then `npm run dev`.

Required local gate: `npm run check`; runtime smoke: `npm run smoke` after build.

Configuration is read once in server bootstrap and converted into typed `AppConfig`. Domain code must not read `process.env`.

Recommended domain layout: `model.ts`, `schema.ts`, `service.ts`, `store.ts`, `errors.ts`, `index.ts`, tests, plus routes/adapters only when needed.
