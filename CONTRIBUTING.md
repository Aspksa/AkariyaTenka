# Contributing

Develop through branches and pull requests. Do not place feature logic in the composition root and do not read another domain's persistence directly.

Before merge run `npm run check` and `npm run smoke`.

A change is complete, where applicable, only when it includes types, runtime schemas, validation, tests, error handling, capabilities, audit coverage for side effects, migrations for persisted data, health integration and documentation.

Do not use `any` or `@ts-ignore` as shortcuts. A documented exception must explain why a type-safe boundary cannot be expressed.
