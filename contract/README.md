# contract

Generated API contract. `openapi.json` (OpenAPI 3.1) is generated from the Hono routes and the Zod schemas in `packages/schemas`, and committed, so the Android (Kotlin) and Windows (C#) clients can be generated from it.

Regenerate it after changing any route or schema, from the repo root:

```powershell
pnpm contract
```

Do not edit `openapi.json` by hand. `server/test/openapi.test.ts` fails (locally and in CI) if it is out of date.
