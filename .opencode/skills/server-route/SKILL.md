---
name: server-route
description: How to add or change an API route in the Screen Time server - schema, route, contract, test. Use when a card adds or changes a /v1 route or its request or response.
---

# Adding or changing a server route

Copy one existing route of the same kind (parent or device) that the card names. Do not read the others.

1. **Schema** in `packages/schemas/src/<area>.ts`: zod objects with `.meta({ id: 'Name' })`, the `type` beside each, and export both from `packages/schemas/src/index.ts`. Fields camelCase. A field the Kotlin client needs must be required or nullable, never optional and nullable at once (the Kotlin generator cannot do both).
2. **Route** in `server/src/<area>/routes.ts`: `createRoute({ method, path, tags, summary, description, security: bearer, request, responses: { 200: jsonResponse(...), ...errorResponses(...) } })` from `../openapi.js`, then `app.openapi(route, handler)`.
   - Parent: `const { familyId } = await requireFamilyParent(c, db, config.jwtSecret)` (`server/src/auth/guards.ts`).
   - Device: `const { deviceId, kidId, familyId } = await requireDevice(c, db)` (`server/src/devices/auth.ts`).
   - Every database read and write inside `withFamily(db, familyId, async (tx) => ...)` (`server/src/db/family.ts`): row-level security applies there.
   - Errors: `throw new ApiError('not_found' | 'conflict' | 'validation_failed', 'Message.')` (`server/src/errors.ts`).
3. **Register** a new route file in `server/src/app.ts` next to the other `register…Routes(app, deps)` lines.
4. **Contract**: `pnpm contract`, then commit `contract/openapi.json`, the Kotlin client and the C# client it changed. Never edit them by hand (reading and editing them is blocked; search for a type name if you must see it).
5. **Test** in `server/test/<area>.test.ts`, shaped like `server/test/games.test.ts`: `createDb(url)`, `client({ db, config: testConfig(url), mailer, pusher })`, `resetDatabase(db, pool)` in `beforeEach`.

**Trap: the server tests are wrapped in `describe.skipIf(!url)`.** Without `TEST_DATABASE_URL` set they are skipped and the run still "passes". Set it first (AGENTS.md "Commands") and check the runner's output says your tests **ran** (not skipped):

```powershell
pnpm --filter @screentime/server exec vitest run test/<area>.test.ts
```
