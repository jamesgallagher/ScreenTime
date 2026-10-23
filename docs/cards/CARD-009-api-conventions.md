# CARD-009: API conventions and OpenAPI contract

| Field | Value |
|---|---|
| Card | CARD-009 |
| Title | API conventions and OpenAPI contract |
| Size | M |
| Depends on | CARD-002, CARD-008 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.1 (Contract), §9 (API surface, error shape) |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-009-api-conventions` |
| PR title | `CARD-009: API conventions and OpenAPI contract` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The server (`server/`, Hono) has one route, `GET /health`, and connects to PostgreSQL at startup (CARD-008). Shared Zod schemas live in `packages/schemas` (`@screentime/schemas`).

Every later server card adds API routes. Before that, this card sets the rules every route follows:

1. **Routes are declared with `@hono/zod-openapi`**, so each route's request and response schemas also describe it in an OpenAPI document.
2. **One error shape for every error** (docs/SPEC.md §9):
   ```json
   { "error": { "code": "validation_failed", "message": "Human readable", "details": {} } }
   ```
   `details` is optional. Codes and statuses: `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `validation_failed` 422, `rate_limited` 429, `internal` 500.
3. **Request logging**: one line per request (method, path, status, time) using Hono's logger, switched off in tests.
4. **The OpenAPI contract is committed** as `contract/openapi.json`. The Android and Windows API clients will be generated from it in later cards. A test fails if the committed file is out of date, so CI catches drift.

## 2. Goal

The server builds every route with `createRouter()`, which gives standard 404, 422, 500 and `ApiError` responses. `pnpm contract` writes `contract/openapi.json`, which describes `GET /health`, `HealthResponse`, `ErrorResponse` and `ErrorCode`. A test fails if that file is not up to date.

## 3. Out of scope

Do **not** do any of these in this card:

- No new real API routes (no `/v1/...`). The only route stays `GET /health`, and its JSON body does not change.
- No authentication, no rate limiting, no CORS (later cards).
- No Kotlin or C# client generation (CARD-029 and CARD-046).
- No Swagger UI and no route that serves the OpenAPI document.
- Do not change `server/src/index.ts`, `server/src/config.ts`, `server/src/db/`, `server/drizzle/`, `server/test/health.test.ts`, `server/test/db.test.ts` or `server/test/config.test.ts`.
- Never edit `contract/openapi.json` by hand. Always generate it with `pnpm contract`.

## 4. Tech and versions

| Item | Version |
|---|---|
| `@hono/zod-openapi` | `^1.6.3` (new dependency of `server`; it needs `hono` 4.10 or newer and Zod 4) |
| `hono` | `^4.13.13` (raised from `^4.9.0` to match) |
| `zod` | `^4.6.7` in both `packages/schemas` and `server` |
| OpenAPI | 3.1.0 |
| Everything else | unchanged from `main` |

Install the packages with these exact commands from the repo root (they update `package.json` files and `pnpm-lock.yaml` for you):

```powershell
pnpm --filter @screentime/server add @hono/zod-openapi@^1.6.3 hono@^4.13.13 zod@^4.6.7
pnpm --filter @screentime/schemas add zod@^4.6.7
```

Afterwards the `dependencies` in the two `package.json` files must look like 5.1 and 5.2.

No new tools to install. Docker is only needed for the optional database check in section 8.

## 5. Files

Create or change exactly these files. Paths are relative to the repo root.

| File | Action |
|---|---|
| `package.json` (root) | change (5.1) |
| `packages/schemas/package.json` | change by the `pnpm add` command (5.2) |
| `server/package.json` | change by the `pnpm add` command plus one script (5.2) |
| `pnpm-lock.yaml` | updated by pnpm (never by hand) |
| `packages/schemas/src/errors.ts` | create (5.3) |
| `packages/schemas/src/health.ts` | replace (5.4) |
| `packages/schemas/src/index.ts` | replace (5.5) |
| `packages/schemas/test/errors.test.ts` | create (5.6) |
| `server/src/errors.ts` | create (5.7) |
| `server/src/router.ts` | create (5.8) |
| `server/src/app.ts` | replace (5.9) |
| `server/scripts/export-openapi.ts` | create (5.10) |
| `contract/openapi.json` | **generated** by `pnpm contract` (5.11) |
| `contract/README.md` | replace (5.12) |
| `server/test/errors.test.ts` | create (5.13) |
| `server/test/openapi.test.ts` | create (5.14) |
| `.github/workflows/typescript.yml` | change (5.15) |
| `AGENTS.md` | change (5.16), the only edit to it allowed |

### 5.1 `package.json`

The whole file after the change. New: the `contract` script.

```json
{
  "name": "screentime",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.22.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm build && pnpm -r test",
    "dev:server": "pnpm --filter @screentime/schemas build && pnpm --filter @screentime/server dev",
    "contract": "pnpm --filter @screentime/schemas build && pnpm --filter @screentime/server contract"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

### 5.2 `packages/schemas/package.json` and `server/package.json`

After the two `pnpm add` commands in section 4, add the `contract` script to `server/package.json` by hand. The two files must then be exactly:

`packages/schemas/package.json`:

```json
{
  "name": "@screentime/schemas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`server/package.json`:

```json
{
  "name": "@screentime/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "contract": "tsx scripts/export-openapi.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@hono/zod-openapi": "^1.6.3",
    "@screentime/schemas": "workspace:*",
    "drizzle-orm": "^0.45.4",
    "hono": "^4.13.13",
    "pg": "^8.23.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

### 5.3 `packages/schemas/src/errors.ts`

`.meta({ id })` gives the schema its name in the OpenAPI document (`#/components/schemas/ErrorResponse`).

```ts
import { z } from 'zod';

/** Machine-readable error codes (docs/SPEC.md §9). */
export const ErrorCode = z
  .enum(['unauthorized', 'forbidden', 'not_found', 'conflict', 'validation_failed', 'rate_limited', 'internal'])
  .meta({ id: 'ErrorCode' });

export type ErrorCode = z.infer<typeof ErrorCode>;

/** Body of every error response. */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof ErrorResponse>;
```

### 5.4 `packages/schemas/src/health.ts`

Same schema as before, plus `.meta({ id: 'HealthResponse' })`.

```ts
import { z } from 'zod';

/** Response body of GET /health. */
export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    time: z.iso.datetime(),
  })
  .meta({ id: 'HealthResponse' });

export type HealthResponse = z.infer<typeof HealthResponse>;
```

### 5.5 `packages/schemas/src/index.ts`

```ts
export { ErrorCode, ErrorResponse } from './errors.js';
export { HealthResponse } from './health.js';
```

### 5.6 `packages/schemas/test/errors.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ErrorResponse } from '../src/index.js';

describe('ErrorResponse', () => {
  it('accepts an error with and without details', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'not_found', message: 'Not found.' } }).success).toBe(true);
    expect(
      ErrorResponse.safeParse({ error: { code: 'conflict', message: 'Taken.', details: { field: 'email' } } }).success,
    ).toBe(true);
  });

  it('rejects an unknown code', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
  });
});
```

### 5.7 `server/src/errors.ts`

Handlers throw `new ApiError(code, message, details?)`; the router turns it into the standard response.

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode, ErrorResponse } from '@screentime/schemas';

/** HTTP status for each error code (docs/SPEC.md §9). */
export const statusForCode: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export function errorBody(code: ErrorCode, message: string, details?: Record<string, unknown>): ErrorResponse {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Throw this from a handler to send an error response with the standard shape. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): ContentfulStatusCode {
    return statusForCode[this.code];
  }

  toBody(): ErrorResponse {
    return errorBody(this.code, this.message, this.details);
  }
}
```

### 5.8 `server/src/router.ts`

Every app and sub-router in the server must be made with `createRouter()`, never `new Hono()` or `new OpenAPIHono()` directly.

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { ApiError, errorBody } from './errors.js';

/**
 * Creates a Hono app for OpenAPI routes with the standard error handling
 * (docs/SPEC.md §9):
 * - a request that fails validation gets 422 `validation_failed` with the Zod issues in `details`;
 * - a thrown `ApiError` gets its own status, code, message and details;
 * - an unknown path gets 404 `not_found`;
 * - any other thrown error is logged and gets 500 `internal`, without leaking its message.
 */
export function createRouter() {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody('validation_failed', 'The request is not valid.', { issues: result.error.issues }), 422);
      }
    },
  });

  router.notFound((c) => c.json(errorBody('not_found', 'Not found.'), 404));

  router.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toBody(), err.status);
    }
    console.error(err);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });

  return router;
}
```

### 5.9 `server/src/app.ts`

Replace the whole file. `GET /health` is now an OpenAPI route; its response body is unchanged. The `500` response is listed so `ErrorResponse` appears in the contract. The explicit return type on `openApiDocument` is needed, or `tsc` fails with error TS2742.

```ts
import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { createRouter } from './router.js';

export const app = createRouter();

if (process.env.NODE_ENV !== 'test') {
  app.use(logger());
}

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['public'],
  summary: 'Check that the server is up',
  responses: {
    200: {
      description: 'The server is up.',
      content: { 'application/json': { schema: HealthResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

app.openapi(healthRoute, (c) => {
  const body = HealthResponse.parse({
    status: 'ok',
    service: 'screentime-server',
    time: new Date().toISOString(),
  });
  return c.json(body, 200);
});

/** The OpenAPI 3.1 document for every route above (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<typeof app.getOpenAPI31Document> {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
```

### 5.10 `server/scripts/export-openapi.ts`

Run by `pnpm contract`. It is outside `src/`, so it is not part of the build output.

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiDocument } from '../src/app.js';

const target = fileURLToPath(new URL('../../contract/openapi.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log(`wrote ${target}`);
```

### 5.11 `contract/openapi.json` (generated)

Do **not** write this file by hand. After 5.1 to 5.10 are in place, run from the repo root:

```powershell
pnpm contract
```

It prints `wrote ...\contract\openapi.json`. The file must be exactly:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Screen Time API",
    "version": "0.1.0"
  },
  "components": {
    "schemas": {
      "HealthResponse": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "ok"
            ]
          },
          "service": {
            "type": "string",
            "minLength": 1
          },
          "time": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "status",
          "service",
          "time"
        ]
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "$ref": "#/components/schemas/ErrorCode"
              },
              "message": {
                "type": "string"
              },
              "details": {
                "type": "object",
                "additionalProperties": {}
              }
            },
            "required": [
              "code",
              "message"
            ]
          }
        },
        "required": [
          "error"
        ]
      },
      "ErrorCode": {
        "type": "string",
        "enum": [
          "unauthorized",
          "forbidden",
          "not_found",
          "conflict",
          "validation_failed",
          "rate_limited",
          "internal"
        ]
      }
    },
    "parameters": {}
  },
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "public"
        ],
        "summary": "Check that the server is up",
        "responses": {
          "200": {
            "description": "The server is up.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/HealthResponse"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected server error.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorResponse"
                }
              }
            }
          }
        }
      }
    }
  },
  "webhooks": {}
}
```

If it differs, a schema or `app.ts` does not match the card. Fix that and run `pnpm contract` again.

### 5.12 `contract/README.md`

Replace the whole file.

````markdown
# contract

Generated API contract. `openapi.json` (OpenAPI 3.1) is generated from the Hono routes and the Zod schemas in `packages/schemas`, and committed, so the Android (Kotlin) and Windows (C#) clients can be generated from it.

Regenerate it after changing any route or schema, from the repo root:

```powershell
pnpm contract
```

Do not edit `openapi.json` by hand. `server/test/openapi.test.ts` fails (locally and in CI) if it is out of date.
````

### 5.13 `server/test/errors.test.ts`

The second `describe` builds a small app with `createRouter()` and three test-only routes, so the error handling can be tested without adding real routes.

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { ErrorResponse } from '@screentime/schemas';
import { app } from '../src/app.js';
import { ApiError, errorBody } from '../src/errors.js';
import { createRouter } from '../src/router.js';

describe('error responses', () => {
  it('answers an unknown path with 404 not_found', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(ErrorResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('maps every ApiError code to its HTTP status', () => {
    const expected = {
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      validation_failed: 422,
      rate_limited: 429,
      internal: 500,
    } as const;
    for (const [code, status] of Object.entries(expected)) {
      expect(new ApiError(code as keyof typeof expected, 'x').status).toBe(status);
    }
  });

  it('leaves details out when there are none', () => {
    expect(errorBody('conflict', 'Taken.')).toEqual({ error: { code: 'conflict', message: 'Taken.' } });
    expect(errorBody('conflict', 'Taken.', { field: 'email' })).toEqual({
      error: { code: 'conflict', message: 'Taken.', details: { field: 'email' } },
    });
  });
});

describe('router error handling', () => {
  // A small test app built the same way as the real one.
  const test = createRouter();
  test.get('/api-error', () => {
    throw new ApiError('forbidden', 'Not your family.', { familyId: 'abc' });
  });
  test.get('/crash', () => {
    throw new Error('secret database detail');
  });
  test.openapi(
    createRoute({
      method: 'post',
      path: '/echo',
      request: {
        body: { content: { 'application/json': { schema: z.object({ name: z.string().min(1) }) } } },
      },
      responses: { 200: { description: 'ok' } },
    }),
    (c) => c.json({ name: c.req.valid('json').name }, 200),
  );

  it('sends an ApiError with its status, code, message and details', async () => {
    const res = await test.request('/api-error');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Not your family.', details: { familyId: 'abc' } },
    });
  });

  it('hides unexpected errors behind 500 internal', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await test.request('/crash');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Something went wrong.' } });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('answers an invalid body with 422 validation_failed and the issues', async () => {
    const res = await test.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(ErrorResponse.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues[0].path).toEqual(['name']);
  });

  it('passes a valid body through', async () => {
    const res = await test.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Alex' });
  });
});
```

### 5.14 `server/test/openapi.test.ts`

The second test is the drift check: it fails whenever someone changes a route or schema and forgets `pnpm contract`.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/app.js';

describe('OpenAPI contract', () => {
  const doc = openApiDocument();

  it('describes GET /health and the shared schemas', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/health']?.get).toBeDefined();
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorCode', 'ErrorResponse', 'HealthResponse']),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
```

### 5.15 `.github/workflows/typescript.yml`

Add one line, `- "contract/**"`, directly after `- "test-vectors/**"`, in **both** path lists (`pull_request` and `push`). Change nothing else. After the change, both lists start like this:

```yaml
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
      - "contract/**"
      - "package.json"
```

### 5.16 `AGENTS.md`

In the "Commands (TypeScript workspace)" code block, replace the line

```
pnpm dev:server    # run the API on http://localhost:8080
```

with these two lines:

```
pnpm dev:server    # run the API on http://localhost:8080 (needs DATABASE_URL, see deploy/README.md)
pnpm contract      # regenerate contract/openapi.json after changing routes or schemas
```

Change nothing else in `AGENTS.md`.

## 6. Detailed spec

### 6.1 Error responses

| Situation | Status | Body |
|---|---|---|
| Unknown path | 404 | `{"error":{"code":"not_found","message":"Not found."}}` |
| Request fails a route's Zod schema | 422 | `{"error":{"code":"validation_failed","message":"The request is not valid.","details":{"issues":[...]}}}` (`issues` are Zod's issues, each with `path` and `message`) |
| Handler throws `new ApiError(code, message, details?)` | from the table in §1 | `{"error":{"code":<code>,"message":<message>,"details":<details>}}`, with `details` left out when not given |
| Handler throws anything else | 500 | `{"error":{"code":"internal","message":"Something went wrong."}}`. The real error is logged with `console.error` and never sent to the client. |

### 6.2 Logging

Outside tests (when `NODE_ENV` is not `test`), every request logs two lines through `hono/logger`:

```
<-- GET /health
--> GET /health 200 3ms
```

Vitest sets `NODE_ENV=test`, so tests print no request logs.

### 6.3 Contract

- `pnpm contract` (repo root) builds `@screentime/schemas`, then runs `server/scripts/export-openapi.ts`, which writes `openApiDocument()` as JSON with 2-space indentation and a final newline to `contract/openapi.json`.
- `server/test/openapi.test.ts` compares the committed file with a freshly generated document, so `pnpm test` and CI fail when they differ.
- Rule for all later cards: after changing a route or schema, run `pnpm contract` and commit `contract/openapi.json` in the same PR.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime`.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-009-api-conventions
   ```
2. Run the two `pnpm add` commands from section 4, add the `contract` script to `server/package.json` (5.2) and to the root `package.json` (5.1). Commit `package.json`, `packages/schemas/package.json`, `server/package.json` and `pnpm-lock.yaml`: `CARD-009: add @hono/zod-openapi`.
3. Create 5.3 to 5.6 (schemas). Run `pnpm --filter @screentime/schemas test`. Commit: `CARD-009: add ErrorResponse schema`.
4. Create 5.7 to 5.10 (server). Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-009: add router with standard errors and OpenAPI health route`.
5. Run `pnpm contract` (5.11) and compare the file with the card. Replace `contract/README.md` (5.12). Commit: `CARD-009: generate contract/openapi.json`.
6. Create 5.13 and 5.14. Run `pnpm test`. Commit: `CARD-009: add error and contract tests`.
7. Make the edits in 5.15 and 5.16. Commit: `CARD-009: run tests on contract changes; document pnpm contract`.
8. Run the acceptance checks in section 8.
9. Push and open the PR (section 10).

## 8. Acceptance criteria

- [ ] `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm typecheck` pass.
- [ ] `pnpm test` passes. Without `TEST_DATABASE_URL`, the per-file results are:
  - `packages/schemas`: `test/health.test.ts (3 tests)` and `test/errors.test.ts (2 tests)`, so `Tests  5 passed (5)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `server`: `test/errors.test.ts (7 tests)`, `test/openapi.test.ts (2 tests)`, `test/config.test.ts (3 tests)`, `test/health.test.ts (2 tests)` and `test/db.test.ts (3 tests | 3 skipped)`, so `Tests  14 passed | 3 skipped (17)`.
- [ ] Running `pnpm contract` again leaves no change: `git status --short contract` prints nothing.
- [ ] `contract/openapi.json` is exactly the content in 5.11.
- [ ] Drift check works. Temporarily change `'Check that the server is up'` in `server/src/app.ts` to `'X'`, run `pnpm --filter @screentime/server test`, and see `test/openapi.test.ts` **fail**. Then undo the change (`git checkout server/src/app.ts`) and see it pass again.
- [ ] (Optional, needs Docker.) The real server logs requests and answers 404 with the new shape. With the CARD-008 database running (see `deploy/README.md`) and `$env:DATABASE_URL` set, run `pnpm dev:server`, then in a second window `Invoke-RestMethod http://localhost:8080/health` (still `status : ok`) and `curl.exe -s http://localhost:8080/nope`, which prints `{"error":{"code":"not_found","message":"Not found."}}`. The server window shows `<-- GET /nope` and `--> GET /nope 404`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 18 files (in any order):
  ```
  .github/workflows/typescript.yml
  AGENTS.md
  contract/README.md
  contract/openapi.json
  package.json
  packages/schemas/package.json
  packages/schemas/src/errors.ts
  packages/schemas/src/health.ts
  packages/schemas/src/index.ts
  packages/schemas/test/errors.test.ts
  pnpm-lock.yaml
  server/package.json
  server/scripts/export-openapi.ts
  server/src/app.ts
  server/src/errors.ts
  server/src/router.ts
  server/test/errors.test.ts
  server/test/openapi.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `packages/schemas/test/errors.test.ts` | `ErrorResponse` accepts bodies with and without `details`, and rejects an unknown code. |
| `server/test/errors.test.ts` | Unknown path → 404 `not_found`; each `ApiError` code maps to its status; `errorBody` leaves out empty details; a thrown `ApiError` keeps status, code, message and details; any other error → 500 `internal` with the message hidden and logged once; an invalid JSON body → 422 `validation_failed` with the issue path `["name"]`; a valid body passes. |
| `server/test/openapi.test.ts` | The document is OpenAPI 3.1.0, has `GET /health` and the `ErrorCode`, `ErrorResponse` and `HealthResponse` schemas, and equals the committed `contract/openapi.json`. |

The existing `server/test/health.test.ts` must still pass unchanged.

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 to 7). Message format: `CARD-009: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-009-api-conventions`
5. Open a PR into `main` titled `CARD-009: API conventions and OpenAPI contract`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-009-api-conventions --title "CARD-009: API conventions and OpenAPI contract" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-009-api-conventions.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck — output: `...`
   - [x] tests — output: schemas `5 passed`, engine `27 passed`, server `14 passed | 3 skipped`
   - [x] pnpm contract is stable — `git status --short contract` empty
   - [x] openapi.json matches the card
   - [x] drift check fails when app.ts changes — output: `...`
   - [ ] (optional) dev server 404 shape — output: `...` (or "not run")
   - [x] only expected files changed — output: 18 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box for a check you actually ran, and paste its real output.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **`error TS2742: The inferred type of 'openApiDocument' cannot be named`**: the return type annotation from 5.9 is missing. Copy the line exactly.
- **`zodSchema.openapi is not a function`**: you called `app.openAPIRegistry.register(...)`. The card does not use it; schemas get their names from `.meta({ id })`. Remove the call.
- **`test/openapi.test.ts` fails with a long diff**: run `pnpm contract` and commit `contract/openapi.json`. If it still differs from 5.11, your code differs from the card.
- **Import `z` from `@hono/zod-openapi` or from `zod`?** In `packages/schemas`, always `import { z } from 'zod'`. Only `server/test/errors.test.ts` imports `z` from `@hono/zod-openapi`, as written.
