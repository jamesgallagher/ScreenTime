# CARD-029: core-model generated Kotlin API client

| Field | Value |
|---|---|
| Card | CARD-029 |
| Title | core-model generated Kotlin API client |
| Size | M |
| Depends on | CARD-009 (the OpenAPI contract) and CARD-004 (Android project), both merged to `main` |
| Spec sections | docs/SPEC.md §4.1 (the "Kotlin client" note under the table), §9 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-029-kotlin-client` |
| PR title | `CARD-029: core-model generated Kotlin API client` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The API is described once, in `contract/openapi.json`, which `pnpm contract` writes from the server's Zod schemas (CARD-009). The web app already uses it. The two Android apps need the same API in Kotlin, and it must never drift from the server: a renamed field must break the build, not a phone in a kid's pocket.

So this card adds a **generator**: a small TypeScript script that reads `contract/openapi.json` and writes two Kotlin files into `android/core-model`:

- `ApiModels.kt`: one `@Serializable` data class or enum for every schema (`Kid`, `DeviceState`, `Pool`, ...).
- `ApiClient.kt`: `class ApiClient` with one `suspend fun` for every route (`getKids()`, `getDeviceState()`, `postDeviceSos(body)`, ...).

You do **not** type these two files. `pnpm contract` writes them, and they are committed. A new server test fails if the committed files are not exactly what the generator writes, the same way the existing test checks `contract/openapi.json`.

The other half of the client is written by hand, `ApiSupport.kt`: the Ktor HTTP client, the bearer token, turning an error answer into an `ApiException`, and two small types (`Opt` and `Conditional`, section 6). `core-model` is a plain Kotlin JVM library, so its tests run on the JVM with Ktor's `MockEngine`, with no phone and no server.

The old hand-written `Pool.kt` and its `PoolTest.kt` are deleted: the generated `Pool` enum replaces it. Nothing else uses it.

Why our own generator and not openapi-generator: it needs no Java tool in the TypeScript build, its output is short and readable, it only has to understand the parts of OpenAPI our contract uses, and it stops with an error on anything else.

## 2. Goal

`pnpm contract` writes `ApiModels.kt` and `ApiClient.kt` with exactly the SHA-256 hashes in section 8; `pnpm test` passes with the new `test/kotlin-client.test.ts`; `.\gradlew.bat assembleDebug test` passes with 13 `ApiClientTest` tests; and all three GitHub Actions checks are green.

## 3. Out of scope

Do **not** do any of these in this card:

- Never edit `ApiModels.kt` or `ApiClient.kt` by hand. If they look wrong, the generator (5.3) is wrong: report it.
- No change to `contract/openapi.json`, `packages/`, `web/`, `server/src/` or `test-vectors/`. `pnpm contract` rewrites `contract/openapi.json`, but it must come out unchanged.
- No change to `core-time`, `core-ui` or the two apps. No Ktor engine (OkHttp, Android) yet: the apps pick one in a later card.
- No other new dependency than the four Ktor libraries and the serialization plugin in 5.6. No new npm package.
- No change to the Gradle wrapper files (`gradlew`, `gradlew.bat`, `gradle/wrapper/`).
- Do not change any file that is not listed in section 5.
- Never commit `local.properties`, keystores, `google-services.json`, `deploy/.env`, or any key or token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, Gradle 9.8.2 (wrapper), AGP 9.4.0, Kotlin 2.4.21, kotlinx-serialization-json 1.11.0, JUnit 6.1.3, Java 17 bytecode.

New on Android:

- Plugin `org.jetbrains.kotlin.plugin.serialization`, version = the Kotlin version (2.4.21).
- `io.ktor:ktor-client-core`, `ktor-client-content-negotiation`, `ktor-serialization-kotlinx-json` 3.6.0, and `ktor-client-mock` 3.6.0 for tests only.

`core-model` gives `ktor-client-core` and `kotlinx-serialization-json` to the apps as `api`, because the apps use their types (`HttpClientEngine`, `JsonObject`).

All commands run in PowerShell. Use PowerShell, not `cmd.exe`. Every Gradle command runs from `C:\Users\james\OpenCode\Testing\ScreenTime\android` with:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

Always use `.\gradlew.bat`, never a Gradle you installed yourself. pnpm commands run from the repo root.

## 5. Files

Create, replace or delete exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Comments use `§` (U+00A7); copy it exactly.

| File | Action |
|---|---|
| `.github/workflows/typescript.yml` | replace (5.1) |
| `server/package.json` | replace (5.2) |
| `server/scripts/kotlin-gen.ts` | create (5.3) |
| `server/scripts/kotlin-client.ts` | create (5.4) |
| `server/test/kotlin-client.test.ts` | create (5.5) |
| `android/gradle/libs.versions.toml` | replace (5.6) |
| `android/build.gradle.kts` | replace (5.7) |
| `android/core-model/build.gradle.kts` | replace (5.8) |
| `android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiSupport.kt` | create (5.9) |
| `android/core-model/src/test/kotlin/au/screentime/core/model/api/ApiClientTest.kt` | create (5.10) |
| `android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiModels.kt` | **generated** by `pnpm contract` (step 3) |
| `android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiClient.kt` | **generated** by `pnpm contract` (step 3) |
| `android/core-model/src/main/kotlin/au/screentime/core/model/Pool.kt` | delete with `git rm` (step 4) |
| `android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt` | delete with `git rm` (step 4) |

That is 14 files: 10 you copy, 2 generated, 2 deleted.

### 5.1 `.github/workflows/typescript.yml`

The only change: the line `- "android/core-model/src/main/kotlin/au/screentime/core/model/api/**"` after `- "contract/**"`, in both `paths` lists, so a hand edit of the generated files runs the drift test.

```yaml
name: TypeScript

on:
  pull_request:
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
      - "contract/**"
      - "android/core-model/src/main/kotlin/au/screentime/core/model/api/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
      - ".dockerignore"
      - "deploy/**"
      - ".github/workflows/typescript.yml"
  push:
    branches: [main]
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "test-vectors/**"
      - "contract/**"
      - "android/core-model/src/main/kotlin/au/screentime/core/model/api/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
      - ".dockerignore"
      - "deploy/**"
      - ".github/workflows/typescript.yml"

concurrency:
  group: typescript-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    name: typecheck and test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_DB: screentime_test
          POSTGRES_USER: screentime
          POSTGRES_PASSWORD: screentime
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U screentime -d screentime_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://screentime:screentime@localhost:5432/screentime_test
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Set up pnpm
        uses: pnpm/action-setup@v4

      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm build && pnpm typecheck

      - name: Test
        run: pnpm test

  docker:
    name: docker compose smoke test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Start the stack
        run: |
          echo "POSTGRES_PASSWORD=ci-only-password" > deploy/.env
          echo "JWT_SECRET=ci-only-secret-that-is-at-least-32-characters" >> deploy/.env
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait

      - name: Check health
        run: |
          curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-all-errors http://localhost:8080/health
          docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api | grep "database migrations applied"

      - name: Check the web app
        run: |
          curl --fail --silent --show-error http://localhost:8080/ | grep '<div id="root"></div>'
          curl --fail --silent --show-error http://localhost:8080/kids | grep '<div id="root"></div>'
          asset=$(curl --fail --silent --show-error http://localhost:8080/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js')
          curl --fail --silent --show-error --head "http://localhost:8080$asset" | grep -i 'cache-control: public, max-age=31536000, immutable'
          test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:8080/v1/nope)" = 404

      - name: Show logs on failure
        if: failure()
        run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs
```

### 5.2 `server/package.json`

The only change: the `contract` script now runs `kotlin-client.ts` after `export-openapi.ts`.

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
    "contract": "tsx scripts/export-openapi.ts && tsx scripts/kotlin-client.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@hono/node-ws": "^1.3.1",
    "@hono/zod-openapi": "^1.6.3",
    "@screentime/engine": "workspace:*",
    "@screentime/schemas": "workspace:*",
    "drizzle-orm": "^0.45.4",
    "firebase-admin": "^14.5.0",
    "hono": "^4.13.13",
    "nodemailer": "^10.2.1",
    "pg": "^8.23.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "@types/ws": "^8.18.2",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "ws": "^8.22.0"
  }
}
```

### 5.3 `server/scripts/kotlin-gen.ts`

The generator: a pure function from the contract to the text of the two Kotlin files. It writes nothing itself, so the test can call it. Section 6 explains its rules.

```typescript
/**
 * Turns contract/openapi.json into the Kotlin API client for the Android apps (docs/SPEC.md §4.1).
 * It only understands the parts of OpenAPI that our contract uses, and it throws on anything else,
 * so a new kind of schema is noticed when `pnpm contract` runs, not on a phone.
 */

type Schema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: Schema | boolean;
};

type Parameter = { name: string; in: string; required?: boolean; schema: Schema };

type Operation = {
  summary?: string;
  security?: unknown[];
  parameters?: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};

export type OpenApiDoc = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

export const PACKAGE = 'au.screentime.core.model.api';
export const HEADER = '// Generated by server/scripts/kotlin-client.ts from contract/openapi.json. Do not edit: run `pnpm contract`.';

const KEYWORDS = new Set(['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while']);

/** `parent-mode` → `ParentMode`, `endedBy` → `EndedBy`. */
function pascal(text: string) {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

function camel(text: string) {
  const p = pascal(text);
  return p[0]!.toLowerCase() + p.slice(1);
}

function name(text: string) {
  return KEYWORDS.has(text) ? `\`${text}\`` : text;
}

/** `tamper.clock` → `TAMPER_CLOCK`, `#0F766E` → `_0F766E`. */
function constant(value: string) {
  const c = value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(c) ? `_${c}` : c;
}

function types(schema: Schema) {
  return Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
}

function refName(ref: string) {
  return ref.replace('#/components/schemas/', '');
}

export function generateKotlin(doc: OpenApiDoc): { models: string; client: string } {
  const schemas = doc.components.schemas;
  const out: string[] = [];
  const declared = new Set<string>();

  /** Records a Kotlin type name. An inline type may not take the name of a schema. */
  function declare(typeName: string, inline: boolean) {
    if (declared.has(typeName) || (inline && schemas[typeName])) {
      throw new Error(`two Kotlin types are named ${typeName}`);
    }
    declared.add(typeName);
  }

  /** A string enum with only these values is a Boolean, like `?active=true`. */
  function isBooleanText(schema: Schema) {
    return schema.enum?.length === 2 && schema.enum.includes('true') && schema.enum.includes('false');
  }

  function isNumberEnum(schema: Schema) {
    return !!schema.anyOf?.every((s) => s.type === 'null' || (s.type === 'number' && s.enum?.every((v) => Number.isInteger(v))));
  }

  /** Whether a value of this schema can be null. */
  function nullable(schema: Schema): boolean {
    if (schema.$ref) {
      return nullable(schemas[refName(schema.$ref)]!);
    }
    if (schema.anyOf) {
      return schema.anyOf.some((s) => s.type === 'null');
    }
    return types(schema).includes('null') || !!schema.enum?.includes(null);
  }

  /** The Kotlin type of a schema, without the `?`. Inline objects and enums are declared as `owner`. */
  function kotlinType(schema: Schema, owner: string): string {
    if (schema.$ref) {
      const target = refName(schema.$ref);
      const s = schemas[target]!;
      // Plain strings and number choices have no Kotlin type of their own.
      if (!s.enum && !s.anyOf && !s.properties && types(s).includes('string')) return 'String';
      if (isNumberEnum(s)) return 'Int';
      return target;
    }
    if (isNumberEnum(schema)) return 'Int';
    if (schema.anyOf) throw new Error(`${owner}: anyOf is only supported for number choices`);
    const t = types(schema).filter((x) => x !== 'null');
    if (t.length !== 1) throw new Error(`${owner}: unsupported type ${JSON.stringify(schema.type)}`);
    switch (t[0]) {
      case 'string':
        if (schema.enum) {
          if (isBooleanText(schema)) return 'Boolean';
          declareEnum(owner, schema, true);
          return owner;
        }
        return 'String';
      case 'integer':
        return 'Int';
      case 'number':
        return 'Double';
      case 'boolean':
        return 'Boolean';
      case 'array':
        return `List<${kotlinType(schema.items!, `${owner}Item`)}${schema.items && nullable(schema.items) ? '?' : ''}>`;
      case 'object':
        if (!schema.properties) {
          if (schema.additionalProperties === undefined) throw new Error(`${owner}: an object needs properties`);
          return 'JsonObject';
        }
        declareClass(owner, schema, true);
        return owner;
      default:
        throw new Error(`${owner}: unsupported type ${t[0]}`);
    }
  }

  function declareEnum(typeName: string, schema: Schema, inline: boolean) {
    declare(typeName, inline);
    const values = schema.enum!.filter((v): v is string => v !== null);
    const lines = values.map((v, i) => `    @SerialName(${JSON.stringify(v)}) ${constant(v)}(${JSON.stringify(v)})${i === values.length - 1 ? ';' : ','}`);
    out.push(`@Serializable\nenum class ${typeName}(override val wire: String) : ApiEnum {\n${lines.join('\n')}\n}`);
  }

  function declareClass(typeName: string, schema: Schema, inline: boolean) {
    declare(typeName, inline);
    const index = out.push('') - 1;
    const required = new Set(schema.required ?? []);
    const props = Object.entries(schema.properties!).map(([prop, s]) => {
      const t = kotlinType(s, typeName + pascal(prop));
      const isNull = nullable(s);
      if (required.has(prop)) return `    val ${name(prop)}: ${t}${isNull ? '?' : ''},`;
      if (isNull) return `    val ${name(prop)}: Opt<${t}> = Opt.Absent,`;
      return `    val ${name(prop)}: ${t}? = null,`;
    });
    out[index] = `@Serializable\ndata class ${typeName}(\n${props.join('\n')}\n)`;
  }

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (schema.properties) {
      declareClass(schemaName, schema, false);
    } else if (schema.enum && !isBooleanText(schema)) {
      declareEnum(schemaName, schema, false);
    } else if (types(schema).includes('array')) {
      declare(schemaName, false);
      const index = out.push('') - 1;
      out[index] = `typealias ${schemaName} = ${kotlinType(schema, schemaName)}`;
    } else if (!(types(schema).includes('string') || isNumberEnum(schema))) {
      throw new Error(`${schemaName}: unsupported schema`);
    }
  }

  const models = [
    HEADER,
    `package ${PACKAGE}`,
    'import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonObject',
    ...out,
  ].join('\n\n');

  // The client: one function per operation, in the order of the contract.
  const functions: string[] = [];
  const seen = new Set<string>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const segments = path.replace(/^\/v1(\/|$)/, '/').split('/').filter(Boolean);
      const fixed = segments.filter((s) => !s.startsWith('{'));
      const endsWithParam = segments.at(-1)?.startsWith('{') ?? false;
      const fn = camel(`${method} ${fixed.join(' ')}${endsWithParam ? ' by id' : ''}`);
      if (seen.has(fn)) throw new Error(`two operations are named ${fn}`);
      seen.add(fn);

      const owner = pascal(fn);
      const params: string[] = [];
      const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path');
      const queryParams = (op.parameters ?? []).filter((p) => p.in === 'query');
      for (const p of op.parameters ?? []) {
        if (p.in !== 'path' && p.in !== 'query') throw new Error(`${method} ${path}: unsupported parameter in ${p.in}`);
      }
      for (const p of pathParams) params.push(`${name(p.name)}: String`);
      const bodySchema = op.requestBody?.content['application/json']?.schema;
      const bodyType = bodySchema ? kotlinType(bodySchema, `${owner}Body`) : null;
      if (bodyType) params.push(`body: ${bodyType}`);
      for (const p of queryParams) {
        const t = kotlinType(p.schema, `${owner}${pascal(p.name)}`);
        params.push(p.required ? `${name(p.name)}: ${t}` : `${name(p.name)}: ${t}? = null`);
      }
      const conditional = '304' in op.responses;
      if (conditional) params.push('ifNoneMatch: String? = null');

      const success = Object.entries(op.responses).find(([code, r]) => code.startsWith('2') && r.content?.['application/json']);
      const resultSchema = success?.[1].content!['application/json']!.schema;
      const resultType = resultSchema ? kotlinType(resultSchema, `${owner}Result`) : 'Unit';
      const returns = conditional ? `Conditional<${resultType}>` : resultType;

      const kotlinPath = path.replace(/\{([^}]+)\}/g, (_, p: string) => `\${segment(${name(p)})}`);
      const args = [`HttpMethod.${pascal(method)}`, `"${kotlinPath}"`, `auth = ${op.security?.length ? 'true' : 'false'}`];
      if (queryParams.length) args.push(`query = listOf(${queryParams.map((p) => `"${p.name}" to ${name(p.name)}`).join(', ')})`);
      if (bodyType) args.push(`body = body, bodyType = typeInfo<${bodyType}>()`);
      if (conditional) args.push('ifNoneMatch = ifNoneMatch');
      const call = `call(${args.join(', ')})`;

      let bodyLines: string;
      if (conditional) {
        bodyLines = [
          `        val response = ${call}`,
          '        return Conditional(',
          `            value = if (response.status == HttpStatusCode.NotModified) null else response.body<${resultType}>(),`,
          '            etag = response.headers[HttpHeaders.ETag],',
          '            date = response.headers[HttpHeaders.Date],',
          '        )',
        ].join('\n');
      } else if (resultType === 'Unit') {
        bodyLines = `        ${call}`;
      } else {
        bodyLines = `        return ${call}.body()`;
      }
      const signature = params.length ? `(\n${params.map((p) => `        ${p},`).join('\n')}\n    )` : '()';
      functions.push(
        [
          '    /**',
          `     * ${op.summary ?? `${method.toUpperCase()} ${path}`}.`,
          '     *',
          `     * \`${method.toUpperCase()} ${path}\``,
          '     */',
          `    suspend fun ${fn}${signature}${resultType === 'Unit' && !conditional ? '' : `: ${returns}`} {`,
          bodyLines,
          '    }',
        ].join('\n'),
      );
    }
  }

  const client = [
    HEADER,
    `package ${PACKAGE}`,
    [
      'import io.ktor.client.call.body',
      'import io.ktor.client.engine.HttpClientEngine',
      'import io.ktor.http.HttpHeaders',
      'import io.ktor.http.HttpMethod',
      'import io.ktor.http.HttpStatusCode',
      'import io.ktor.util.reflect.typeInfo',
    ].join('\n'),
    [
      '/**',
      ' * Every route of the Screen Time API (docs/SPEC.md §9). Each call throws [ApiException] when the server answers with an error.',
      ' * [token] gives the access token in the parent app and the device token in the kid app, or null when there is none.',
      ' */',
      'class ApiClient(',
      '    baseUrl: String,',
      '    engine: HttpClientEngine,',
      '    token: suspend () -> String?,',
      ') : ApiClientBase(baseUrl, engine, token) {',
      functions.join('\n\n'),
      '}',
    ].join('\n'),
  ].join('\n\n');

  return { models: `${models}\n`, client: `${client}\n` };
}
```

### 5.4 `server/scripts/kotlin-client.ts`

Reads `contract/openapi.json`, calls the generator, and writes the two files. `pnpm contract` runs it.

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKotlin, type OpenApiDoc } from './kotlin-gen.js';

const contract = fileURLToPath(new URL('../../contract/openapi.json', import.meta.url));
const dir = fileURLToPath(new URL('../../android/core-model/src/main/kotlin/au/screentime/core/model/api/', import.meta.url));
const { models, client } = generateKotlin(JSON.parse(readFileSync(contract, 'utf8')) as OpenApiDoc);
writeFileSync(`${dir}ApiModels.kt`, models);
writeFileSync(`${dir}ApiClient.kt`, client);
console.log(`wrote ${dir}ApiModels.kt and ApiClient.kt`);
```

### 5.5 `server/test/kotlin-client.test.ts`

Needs no database. The first test is the drift check.

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateKotlin, type OpenApiDoc } from '../scripts/kotlin-gen.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const doc = JSON.parse(read('../../contract/openapi.json')) as OpenApiDoc;
const api = '../../android/core-model/src/main/kotlin/au/screentime/core/model/api/';

describe('Kotlin API client', () => {
  const { models, client } = generateKotlin(doc);

  it('matches the committed ApiModels.kt and ApiClient.kt (run `pnpm contract` if this fails)', () => {
    expect(read(`${api}ApiModels.kt`)).toBe(models);
    expect(read(`${api}ApiClient.kt`)).toBe(client);
  });

  it('has one function for every operation in the contract', () => {
    const operations = Object.values(doc.paths).flatMap((methods) => Object.keys(methods));
    expect(client.match(/^ {4}suspend fun /gm)).toHaveLength(operations.length);
    expect(client).toContain('suspend fun getKidsById(');
    expect(client).toContain('suspend fun getDeviceState(\n        ifNoneMatch: String? = null,\n    ): Conditional<DeviceState> {');
  });

  it('maps optional and nullable fields the way docs/SPEC.md §4.1 says', () => {
    // Required, required and nullable, optional, optional and nullable.
    expect(models).toContain('data class ParentCreate(\n    val email: String,\n    val displayName: String,\n    val phoneE164: Opt<String> = Opt.Absent,\n)');
    expect(models).toContain('    val phoneE164: String?,\n');
    expect(models).toContain('data class FamilyPatch(\n    val name: String? = null,');
    expect(models).toContain('    @SerialName("tamper.clock") TAMPER_CLOCK("tamper.clock"),');
    expect(models).toContain('typealias NotificationPrefsPut = List<NotificationPrefsPutItem>');
  });

  it('refuses a schema it does not understand', () => {
    const bad = { paths: {}, components: { schemas: { Odd: { anyOf: [{ type: 'string' }, { type: 'integer' }] } } } } as OpenApiDoc;
    expect(() => generateKotlin(bad)).toThrow('Odd: unsupported schema');
    const clash = {
      paths: {},
      components: {
        schemas: {
          Kid: { type: 'object', properties: { pool: { type: 'string', enum: ['a'] } } },
          KidPool: { type: 'string', enum: ['b'] },
        },
      },
    } as OpenApiDoc;
    expect(() => generateKotlin(clash)).toThrow('two Kotlin types are named KidPool');
  });
});
```

### 5.6 `android/gradle/libs.versions.toml`

The only changes: the `ktor` version, the four `ktor-...` libraries and the `kotlin-serialization` plugin.

```toml
[versions]
agp = "9.4.0"
kotlin = "2.4.21"
composeBom = "2026.09.00"
activityCompose = "1.13.0"
junit = "6.1.3"
kotlinxSerialization = "1.11.0"
ktor = "3.6.0"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
junit-bom = { group = "org.junit", name = "junit-bom", version.ref = "junit" }
junit-jupiter = { group = "org.junit.jupiter", name = "junit-jupiter" }
junit-platform-launcher = { group = "org.junit.platform", name = "junit-platform-launcher" }
kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "kotlinxSerialization" }
ktor-client-core = { group = "io.ktor", name = "ktor-client-core", version.ref = "ktor" }
ktor-client-content-negotiation = { group = "io.ktor", name = "ktor-client-content-negotiation", version.ref = "ktor" }
ktor-serialization-kotlinx-json = { group = "io.ktor", name = "ktor-serialization-kotlinx-json", version.ref = "ktor" }
ktor-client-mock = { group = "io.ktor", name = "ktor-client-mock", version.ref = "ktor" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

### 5.7 `android/build.gradle.kts`

The only change: the `kotlin.serialization` plugin line.

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

### 5.8 `android/core-model/build.gradle.kts`

The only changes: the `kotlin.serialization` plugin line, and the comment and five Ktor and kotlinx lines (plus a blank line) at the top of `dependencies`.

```kotlin
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // The apps use the client's types and pick the engine, so these two are api.
    api(libs.ktor.client.core)
    api(libs.kotlinx.serialization.json)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)

    testImplementation(libs.ktor.client.mock)
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}
```

### 5.9 `android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiSupport.kt`

The hand-written half of the client. The generated `ApiClient` extends `ApiClientBase`.

```kotlin
package au.screentime.core.model.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.util.reflect.TypeInfo
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

// The hand-written half of the API client. ApiModels.kt and ApiClient.kt are generated from contract/openapi.json.

/** How the API reads and writes JSON. A field the server adds later is ignored, so an old app keeps working. */
val ApiJson = Json { ignoreUnknownKeys = true }

/** A value that the API sends as text, like `screens` for [Pool.SCREENS]. */
interface ApiEnum {
    val wire: String
}

/**
 * A field that may be left out or sent as null, and the two mean different things.
 * In [ParentPatch], leaving `phoneE164` out keeps the number, and `Opt.Value(null)` removes it.
 */
@Serializable(with = OptSerializer::class)
sealed interface Opt<out T : Any> {
    /** Left out of the JSON. */
    data object Absent : Opt<Nothing>

    /** Sent, as [value] or as null. */
    data class Value<out T : Any>(val value: T?) : Opt<T>
}

/** The value, or null when it was left out or sent as null. */
val <T : Any> Opt<T>.valueOrNull: T?
    get() = (this as? Opt.Value)?.value

class OptSerializer<T : Any>(private val value: KSerializer<T>) : KSerializer<Opt<T>> {
    private val inner = value.nullable

    override val descriptor: SerialDescriptor = inner.descriptor

    override fun serialize(encoder: Encoder, value: Opt<T>) {
        when (value) {
            // A field that is Opt.Absent is its default, and ApiJson never writes defaults.
            Opt.Absent -> throw SerializationException("Opt.Absent cannot be written")
            is Opt.Value -> inner.serialize(encoder, value.value)
        }
    }

    override fun deserialize(decoder: Decoder): Opt<T> = Opt.Value(inner.deserialize(decoder))
}

/** The server answered with an error. [error] is null when the body was not the API's error JSON. */
class ApiException(val status: Int, val error: ErrorResponseError?) :
    Exception("HTTP $status" + (error?.let { " ${it.code.wire}: ${it.message}" } ?: ""))

/**
 * The answer to a request sent with `If-None-Match`. [value] is null when the server answered 304 Not Modified.
 * [etag] is the version to send next time, and [date] is the server's `Date` header.
 */
data class Conditional<out T>(val value: T?, val etag: String?, val date: String?)

/** What every generated call uses: the HTTP client, the token and the error handling. */
abstract class ApiClientBase(
    private val baseUrl: String,
    engine: HttpClientEngine,
    private val token: suspend () -> String?,
) : AutoCloseable {
    private val http = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
    }

    /** Sends one request. Throws [ApiException] unless the status is 2xx, or 304 for a request sent with [ifNoneMatch]. */
    protected suspend fun call(
        method: HttpMethod,
        path: String,
        auth: Boolean,
        query: List<Pair<String, Any?>> = emptyList(),
        body: Any? = null,
        bodyType: TypeInfo? = null,
        ifNoneMatch: String? = null,
    ): HttpResponse {
        val response = http.request {
            this.method = method
            url(baseUrl.trimEnd('/') + path)
            if (auth) {
                token()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            }
            for ((name, value) in query) {
                when (value) {
                    null -> {}
                    is ApiEnum -> parameter(name, value.wire)
                    else -> parameter(name, value.toString())
                }
            }
            if (ifNoneMatch != null) {
                header(HttpHeaders.IfNoneMatch, ifNoneMatch)
            }
            if (bodyType != null) {
                contentType(ContentType.Application.Json)
                setBody(body, bodyType)
            }
        }
        val notModified = ifNoneMatch != null && response.status == HttpStatusCode.NotModified
        if (!response.status.isSuccess() && !notModified) {
            val error = try {
                response.body<ErrorResponse>().error
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            throw ApiException(response.status.value, error)
        }
        return response
    }

    /** A path parameter, encoded so that a `/` in it stays inside the segment. */
    protected fun segment(value: String): String = value.encodeURLPathPart()

    override fun close() = http.close()
}
```

### 5.10 `android/core-model/src/test/kotlin/au/screentime/core/model/api/ApiClientTest.kt`

Each test gives the client a `MockEngine` that records the request and sends back a fixed answer.

```kotlin
package au.screentime.core.model.api

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ApiClientTest {
    private val requests = mutableListOf<HttpRequestData>()

    /** A client whose server always answers with [handler]. */
    private fun client(
        token: String? = "tok",
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ) = ApiClient(
        "https://api.example/",
        MockEngine { request ->
            requests += request
            handler(request)
        },
        token = { token },
    )

    private fun MockRequestHandleScope.json(text: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun HttpRequestData.bodyText() = (body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun getSendsTheTokenAndReadsAList() = runBlocking {
        val api = client { json("""[{"id":"k1","name":"Mia","avatarColor":"#0F766E"}]""") }

        val kids = api.getKids()

        assertEquals(listOf(Kid("k1", "Mia", AvatarColor._0F766E)), kids)
        assertEquals(HttpMethod.Get, requests.single().method)
        assertEquals("https://api.example/v1/kids", requests.single().url.toString())
        assertEquals("Bearer tok", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun aPublicRouteSendsNoTokenAnd204ReturnsUnit() = runBlocking {
        val api = client { respond("", HttpStatusCode.NoContent) }

        api.postAuthOtpRequest(OtpRequest("dad@example.com"))

        val request = requests.single()
        assertNull(request.headers[HttpHeaders.Authorization])
        assertEquals("application/json", request.body.contentType.toString())
        assertEquals("""{"email":"dad@example.com"}""", request.bodyText())
    }

    @Test
    fun anOptionalFieldIsLeftOutAndOptCanSendNull() = runBlocking {
        val parent = """{"id":"p1","email":"mum@example.com","displayName":"Mum","phoneE164":null}"""
        val api = client { json(parent) }

        api.patchFamilyParentsById("p1", ParentPatch(displayName = "Mum"))
        api.patchFamilyParentsById("p1", ParentPatch(phoneE164 = Opt.Value(null)))
        api.patchFamilyParentsById("p1", ParentPatch(phoneE164 = Opt.Value("+61400000000")))

        assertEquals("""{"displayName":"Mum"}""", requests[0].bodyText())
        assertEquals("""{"phoneE164":null}""", requests[1].bodyText())
        assertEquals("""{"phoneE164":"+61400000000"}""", requests[2].bodyText())
    }

    @Test
    fun aRequiredNullableFieldIsAlwaysSent() = runBlocking {
        val api = client { respond("", HttpStatusCode.NoContent) }

        api.putMePushToken(PushTokenPut(fcmToken = null))

        assertEquals("""{"fcmToken":null}""", requests.single().bodyText())
    }

    @Test
    fun anOptFieldIsReadBack() {
        val present = ApiJson.decodeFromString<ParentPatch>("""{"phoneE164":null}""")
        val missing = ApiJson.decodeFromString<ParentPatch>("""{}""")

        assertEquals(Opt.Value(null), present.phoneE164)
        assertEquals(Opt.Absent, missing.phoneE164)
        assertNull(missing.phoneE164.valueOrNull)
    }

    @Test
    fun queryParametersUseTheWireTextAndSkipNulls() = runBlocking {
        val api = client { json("[]") }

        api.getRequests(status = TimeRequestStatus.PENDING, limit = 10)
        api.getSos(active = true)

        assertEquals("https://api.example/v1/requests?status=pending&limit=10", requests[0].url.toString())
        assertEquals("https://api.example/v1/sos?active=true", requests[1].url.toString())
    }

    @Test
    fun aPathParameterIsEncoded() = runBlocking {
        val api = client { json("""{"id":"a/b","name":"Mia","avatarColor":"#0F766E"}""") }

        api.getKidsById("a/b")

        assertEquals("/v1/kids/a%2Fb", requests.single().url.encodedPath)
    }

    @Test
    fun anErrorBecomesApiException() = runBlocking {
        val api = client {
            json("""{"error":{"code":"not_found","message":"Not found."}}""", HttpStatusCode.NotFound)
        }

        val e = assertThrows<ApiException> { runBlocking { api.getKidsById("k9") } }

        assertEquals(404, e.status)
        assertEquals(ErrorCode.NOT_FOUND, e.error?.code)
        assertEquals("HTTP 404 not_found: Not found.", e.message)
    }

    @Test
    fun anErrorThatIsNotJsonStillBecomesApiException() = runBlocking {
        val api = client { respond("Bad gateway", HttpStatusCode.BadGateway) }

        val e = assertThrows<ApiException> { runBlocking { api.getHealth() } }

        assertEquals(502, e.status)
        assertNull(e.error)
    }

    @Test
    fun unknownFieldsAreIgnored() = runBlocking {
        val api = client { json("""{"status":"ok","service":"screentime","time":"2026-10-26T10:00:00Z","new":1}""") }

        val health = api.getHealth()

        assertEquals(HealthResponseStatus.OK, health.status)
    }

    @Test
    fun deviceStateSendsIfNoneMatchAndReads304() = runBlocking {
        val api = client {
            respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.Date, "Mon, 26 Oct 2026 10:00:00 GMT"))
        }

        val state = api.getDeviceState(ifNoneMatch = "\"v7\"")

        assertEquals("\"v7\"", requests.single().headers[HttpHeaders.IfNoneMatch])
        assertNull(state.value)
        assertEquals("Mon, 26 Oct 2026 10:00:00 GMT", state.date)
    }

    @Test
    fun a304WithoutIfNoneMatchIsAnError() = runBlocking {
        val api = client { respond("", HttpStatusCode.NotModified) }

        val e = assertThrows<ApiException> { runBlocking { api.getMe() } }

        assertEquals(304, e.status)
    }

    @Test
    fun numberChoicesAndNullableReferencesAreRead() {
        val text = """{"id":"r1","durationMin":null,"startedAt":"2026-10-26T10:00:00Z"}"""

        assertNull(ApiJson.decodeFromString<ParentModeByCode>(text).durationMin)
        assertEquals("""{"durationMin":15}""", ApiJson.encodeToString(ParentModeStart(15)))
        assertEquals("""{"durationMin":null}""", ApiJson.encodeToString(ParentModeStart(null)))
    }
}
```

## 6. Detailed spec

### 6.1 How a schema becomes Kotlin

| In `contract/openapi.json` | In `ApiModels.kt` |
|---|---|
| `string` (any `format`, any `pattern`), and `$ref` to a plain string schema like `LocalDate` | `String` |
| `integer` / `number` / `boolean` | `Int` / `Double` / `Boolean` |
| `anyOf` of number choices, like `ParentModeDuration` (`2`, `5`, `15`, `60` or null) | `Int` (`Int?` when null is a choice) |
| a string `enum` | `enum class X(override val wire: String) : ApiEnum`, each value with `@SerialName("<text>")`; `tamper.clock` → `TAMPER_CLOCK`, `#0F766E` → `_0F766E`; `null` in the list makes the field nullable instead |
| a string enum of just `"true"` and `"false"` (the `active` query of `GET /v1/sos`) | `Boolean` |
| `object` with `properties` | `@Serializable data class` |
| `object` with only `additionalProperties` (event payloads, error details) | `JsonObject` |
| `array` | `List<T>`; a top-level array schema (`NotificationPrefsPut`) is a `typealias` |
| an inline object or enum | its own top-level type named owner + field: `Me.parent` → `MeParent`, `DeviceState.parents[]` → `DeviceStateParentsItem`, `Sos.endedBy` → `SosEndedBy` |

Anything else (for example `anyOf` of a string and an integer) makes the generator throw `<name>: unsupported schema`. So does a clash of two type names.

### 6.2 Required, optional and nullable fields

| Field in the schema | Kotlin | JSON written |
|---|---|---|
| required | `val x: T` | always |
| required and nullable | `val x: T?` (no default) | always, `null` included |
| optional | `val x: T? = null` | left out when null |
| optional and nullable | `val x: Opt<T> = Opt.Absent` | left out when `Opt.Absent`; `Opt.Value(v)` writes `v`; `Opt.Value(null)` writes `null` |

The last row exists because "left out" and "null" mean different things to the server. In `PATCH /v1/family/parents/{id}`, leaving `phoneE164` out keeps the number, and `"phoneE164": null` removes it. `ApiJson` leaves out every field that has its default value, which is how `Opt.Absent` and `= null` fields are left out. `ApiJson` also ignores fields it does not know, so an old app keeps working when the server adds one.

### 6.3 How an operation becomes a function

- Name: the HTTP method, then the path after `/v1` with the `{...}` parts dropped, in camelCase, plus `ById` when the path ends with a `{...}`. `GET /v1/kids` → `getKids`, `GET /v1/kids/{kidId}` → `getKidsById`, `GET /v1/kids/{kidId}/grants` → `getKidsGrants`, `POST /v1/device/sos/{id}/end` → `postDeviceSosEnd`, `GET /health` → `getHealth`. Two operations with the same name make the generator throw.
- Parameters, in this order: path parameters (`String`), `body` (the request schema), query parameters (`T? = null`). A query value of `null` is not sent; an enum is sent as its `wire` text.
- Returns the schema of the first 2xx answer, or `Unit` when there is none (204).
- Routes with `security` send `Authorization: Bearer <token>`; public routes (`/health`, `/v1/auth/otp/...`, `/v1/auth/refresh`, `/v1/enrol`) never do.
- A route with a 304 answer (only `GET /v1/device/state`) takes `ifNoneMatch: String? = null`, sends it as `If-None-Match`, and returns `Conditional<DeviceState>`: `value` is null on 304, and `etag` and `date` are the answer's `ETag` and `Date` headers (SPEC §8.2).
- Any other answer that is not 2xx throws `ApiException(status, error)`, where `error` is the API's `{ "error": { code, message } }` or null when the body was something else (a proxy's HTML page, for example).

### 6.4 The public API of `core-model` after this card

| Name | What it is |
|---|---|
| `ApiClient(baseUrl: String, engine: HttpClientEngine, token: suspend () -> String?)` | every route; `AutoCloseable` |
| `ApiException(status: Int, error: ErrorResponseError?)` | thrown on an error answer |
| `Opt<T>`, `Opt.Absent`, `Opt.Value(value)`, `opt.valueOrNull` | section 6.2 |
| `Conditional<T>(value, etag, date)` | section 6.3 |
| `ApiJson` | the `Json` the client uses |
| `ApiEnum` | every generated enum; `wire` is the API text |
| the models | generated, in package `au.screentime.core.model.api` |

`Pool` is now `au.screentime.core.model.api.Pool` with `wire` instead of `apiValue`; the old `au.screentime.core.model.Pool` is gone.

## 7. Steps

All commands in PowerShell. Use PowerShell, not `cmd.exe`.

1. Start from the latest `main` and create the branch:
   ```powershell
   cd C:\Users\james\OpenCode\Testing\ScreenTime
   git checkout main
   git pull origin main
   git checkout -b bob/card-029-kotlin-client
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-029-kotlin-client.md` must exist, and `docs/SPEC.md` must contain `**Kotlin client (CARD-029).**`. If not, run `git pull origin main` again, and if it is still wrong, stop and ask James.
2. Replace 5.2, and create 5.3 and 5.4.
3. Generate the Kotlin files:
   ```powershell
   pnpm contract
   ```
   It ends with `wrote ...ApiModels.kt and ApiClient.kt`. Check the two hashes and that the contract did not change (section 8). If a hash is different, compare 5.3 with this card again, above all the spaces inside the template strings; never edit the generated files.
4. Replace 5.6, 5.7 and 5.8, create 5.9, and delete the old files:
   ```powershell
   git rm android/core-model/src/main/kotlin/au/screentime/core/model/Pool.kt android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :core-model:build
   cd ..
   ```
   Commit (with the generated files and 5.2 to 5.4): `CARD-029: generate the Kotlin API client`.
5. Create 5.10, 5.5 and 5.1. Run `pnpm test` and `.\gradlew.bat :core-model:test`. Commit: `CARD-029: test the Kotlin API client`.
6. Run the acceptance checks in section 8.
7. Push and open the PR (section 10).
8. Wait for the CI checks to finish (`gh pr checks <number> --watch`).
9. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm contract` writes the generated files with exactly these hashes, and leaves the contract unchanged. From the repo root:
  ```powershell
  pnpm contract
  $api = "android\core-model\src\main\kotlin\au\screentime\core\model\api"
  (Get-FileHash "$api\ApiModels.kt" -Algorithm SHA256).Hash.ToLower()
  (Get-FileHash "$api\ApiClient.kt" -Algorithm SHA256).Hash.ToLower()
  git status --short contract
  ```
  Output: `38f5833d8b45d40e6353276275fe25d1040cb3ec49b516cb37a0cc8371f490d8`, then `41ad4c1a77778801ba7d5784de7bd84835568efd197af5678f99a15dae98b881`, then nothing for `git status`.
- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `Tests  49 passed (49)`.
  - `server`: `test/kotlin-client.test.ts (4 tests)`, `Tests  53 passed | 171 skipped (224)`.
- [ ] The database tests pass against PostgreSQL 18. Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  ```
  Output: `Tests  224 passed (224)`.
- [ ] From `android`, with `JAVA_HOME` set as in section 4, `.\gradlew.bat assembleDebug test` ends with `BUILD SUCCESSFUL`.
- [ ] The Kotlin tests really ran, with no failures. From `android`, this prints three lines:
  ```powershell
  Select-String -Path core-time\build\test-results\test\*.xml, core-model\build\test-results\test\*.xml -Pattern '<testsuite ' | ForEach-Object { $_.Line -replace '.*<testsuite name="([^"]*)".*(tests="\d+").*(failures="\d+").*(errors="\d+").*', '$1 $2 $3 $4' }
  ```
  Output, in any order:
  ```
  au.screentime.core.time.DurationFormatTest tests="9" failures="0" errors="0"
  au.screentime.core.time.EngineVectorsTest tests="27" failures="0" errors="0"
  au.screentime.core.model.api.ApiClientTest tests="13" failures="0" errors="0"
  ```
  If you also see `au.screentime.core.model.PoolTest`, that is an old XML file from before the delete: run `.\gradlew.bat :core-model:clean :core-model:test` and check again.
- [ ] `ktor-client-mock` is a test dependency only. From `android`, this prints `True`:
  ```powershell
  (.\gradlew.bat :core-model:dependencies --configuration runtimeClasspath | Out-String) -notmatch 'ktor-client-mock'
  ```
- [ ] `git status` does **not** list `deploy/.env`, `android/local.properties` or anything under `build/`.
- [ ] All three GitHub Actions checks are green on the PR: **Android / build and test**, **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. From the repo root, `git diff --name-only main...HEAD` lists exactly these 14 files (in any order):
  ```
  .github/workflows/typescript.yml
  android/build.gradle.kts
  android/core-model/build.gradle.kts
  android/core-model/src/main/kotlin/au/screentime/core/model/Pool.kt
  android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiClient.kt
  android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiModels.kt
  android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiSupport.kt
  android/core-model/src/test/kotlin/au/screentime/core/model/PoolTest.kt
  android/core-model/src/test/kotlin/au/screentime/core/model/api/ApiClientTest.kt
  android/gradle/libs.versions.toml
  server/package.json
  server/scripts/kotlin-client.ts
  server/scripts/kotlin-gen.ts
  server/test/kotlin-client.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `server/test/kotlin-client.test.ts` | The committed `ApiModels.kt` and `ApiClient.kt` are exactly what the generator writes from the committed contract. There is one `suspend fun` per operation. The four field rules of 6.2, an enum name and the typealias come out as written. An unknown schema shape and a type name clash both throw. |
| `android/core-model/src/test/kotlin/au/screentime/core/model/api/ApiClientTest.kt` | A GET sends the bearer token to the right URL and reads a list. A public route sends no token, sends JSON, and a 204 returns. An optional field is left out, and `Opt` sends null or a value. A required nullable field is always sent. `Opt` reads back as `Absent` or `Value(null)`. Query values use the enum text and skip nulls; `active=true` is sent as text. A `/` in a path parameter is encoded. An error answer becomes `ApiException` with the code, also when the body is not JSON. Unknown fields are ignored. `getDeviceState` sends `If-None-Match` and reads a 304; a 304 elsewhere is an error. A number choice and a nullable reference read and write. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 4 and 5). Message format: `CARD-029: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-029-kotlin-client`
5. Open a PR into `main` titled `CARD-029: core-model generated Kotlin API client`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-029-kotlin-client --title "CARD-029: core-model generated Kotlin API client" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-029-kotlin-client.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] generated files — output: the two hashes, contract unchanged
   - [x] install, build, typecheck, test — output: `53 passed | 171 skipped (224)` for the server, lockfile unchanged
   - [x] database tests — output: `Tests  224 passed (224)`
   - [x] assembleDebug test — output: `BUILD SUCCESSFUL`
   - [x] Kotlin tests ran — output: `DurationFormatTest tests="9"`, `EngineVectorsTest tests="27"`, `ApiClientTest tests="13"`, all `failures="0"`
   - [x] ktor-client-mock is test only — output: `True`
   - [x] deploy/.env, local.properties and build/ not tracked
   - [x] three CI checks green
   - [x] only expected files changed — output: 14 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **A hash in section 8 is different**: the generated text differs from Claude's by at least one character. Copy 5.3 again exactly (spaces inside the backtick strings matter), run `pnpm contract`, and check again. If it still differs, report both hashes and the first 20 lines of `git diff` on the generated file against the version you expected; do not edit the generated files to make the hash match.
- **`kotlin-client.test.ts` fails with a diff**: the committed generated files are not what the generator writes. Run `pnpm contract` again and commit the result. Never change the test.
- **`pnpm contract` changes `contract/openapi.json`**: something outside this card changed. Run `git checkout -- contract/openapi.json`, run `git status`, and report it.
- **`Unresolved reference: Serializable`, `serializer` or `@Serializable` errors in Kotlin**: the serialization plugin is missing; check the plugin lines of 5.6, 5.7 and 5.8.
- **`Unresolved reference: ktor`**: check the four libraries in 5.6 and the `dependencies` of 5.8. Gradle turns the `-` in `ktor-client-content-negotiation` into `.` in `libs.ktor.client.content.negotiation`.
- **`Unresolved reference: Pool` in an app**: report it (nothing used the old `Pool` when this card was written).
- **Gradle cannot download Ktor**: Maven Central sometimes answers 429 (too many requests). Wait a minute and run the same command again.
- **Gradle says the SDK location is not found**: create `android\local.properties` (git-ignored, never commit it) with the one line `sdk.dir=C:/Users/james/AppData/Local/Android/Sdk`, as in CARD-004.
- **Temporary files** (the PR body, any helper script) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **Every difference from the card is a deviation**, in any file, including tests, comments and how you ran a check. List each one under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-029. Please review and merge if it is good.

CARD: CARD-029 core-model generated Kotlin API client
PR: <full PR URL>
Branch: bob/card-029-kotlin-client
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
