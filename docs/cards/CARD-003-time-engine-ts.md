# CARD-003: Time engine in TypeScript

| Field | Value |
|---|---|
| Card | CARD-003 |
| Title | Time engine in TypeScript |
| Size | M |
| Depends on | CARD-001, CARD-002 (merged to `main`) |
| Spec sections | docs/SPEC.md §7 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-003-time-engine-ts` |
| PR title | `CARD-003: Time engine in TypeScript` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The **time engine** is one pure function that answers, for one kid and one pool ("Screens" or "Phone") on one day: *how much time is left, is the device locked, and when will it next lock?* The same function will later be written in Kotlin (Android) and C# (Windows). All three must give identical answers, so the expected answers live in shared JSON files in `test-vectors/engine/`. **Those files already exist on `main` (26 cases). Do not edit them.** Your job is to write the TypeScript engine that passes all of them.

Already on `main`: the pnpm workspace (pnpm 11, Node 24) with `packages/schemas` and `server`, and a CI workflow `.github/workflows/typescript.yml`.

## 2. Goal

A new workspace package `@screentime/engine` in `packages/engine/` exporting `evaluate(input): EngineResult`, plus a Vitest test that runs every file in `test-vectors/engine/` and checks every output field. CI runs it.

## 3. Out of scope

- Do not change any file in `test-vectors/`. If a vector seems wrong, stop and report it under "Blockers / questions". Do not "fix" the vector.
- Do not use the engine from the server yet (a later card does that).
- No Kotlin or C# engine.
- No new dependencies besides the ones listed in section 4.
- Do not change `packages/schemas` or `server`.

## 4. Tech and versions

| Package | Range | Where |
|---|---|---|
| `luxon` | `^3.7.0` | engine dependency (time zones and local dates) |
| `@types/luxon` | `^3.7.0` | engine dev dependency |
| `@types/node` | `^24.0.0` | engine dev dependency |
| `typescript` | `^5.9.0` | engine dev dependency |
| `vitest` | `^3.2.0` | engine dev dependency |

Use **luxon** for anything involving the family time zone (turning "2026-10-22 at 07:00 in Australia/Sydney" into an instant). Do **not** do time-zone maths by hand and never add 24 hours to get "tomorrow": daylight-saving days are 23 or 25 hours long. Inside the engine, work with epoch milliseconds (`number`) for instants.

## 5. Files

```
packages/engine/
├── package.json          new (exact contents below)
├── tsconfig.json         new (exact contents below)
├── src/index.ts          new (exact contents below)
├── src/engine.ts         new (you write it, section 6)
└── test/vectors.test.ts  new (exact contents below)
.github/workflows/typescript.yml   change: add one path (section 5.6)
pnpm-lock.yaml                     updated by pnpm install
```

### 5.1 `packages/engine/package.json`

```json
{
  "name": "@screentime/engine",
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
    "luxon": "^3.7.0"
  },
  "devDependencies": {
    "@types/luxon": "^3.7.0",
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

### 5.2 `packages/engine/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

### 5.3 `packages/engine/src/index.ts`

```ts
export * from './engine.js';
```

### 5.4 Types in `packages/engine/src/engine.ts` (use exactly these names)

```ts
export type LockReason = 'out_of_time' | 'bedtime' | 'before_wake';

export interface EngineInput {
  /** Family IANA time zone, e.g. "Australia/Sydney". */
  tz: string;
  /** Local date being evaluated, "YYYY-MM-DD". */
  date: string;
  /** Trusted current instant, ISO 8601 with offset. */
  now: string;
  /** Today's schedule for this pool. */
  day: { allowanceMin: number; wake: string; bedtime: string };
  /** Grants for this kid + pool + date. minutes may be negative. */
  grants: { minutes: number; createdAt: string }[];
  /** Usage segments of ALL devices in this pool. end null = still open (read as now). */
  segments: { start: string; end: string | null }[];
}

export interface EngineResult {
  locked: boolean;
  lockReason: LockReason | null;
  remainingSec: number;
  /** ISO 8601 UTC (Date.toISOString()), or null if no lock before the end of the day. */
  nextLockAt: string | null;
  /** ISO 8601 UTC (Date.toISOString()). */
  reevaluateAt: string;
  usedSec: number;
  overspendSec: number;
}

export function evaluate(input: EngineInput): EngineResult {
  // section 6
}
```

### 5.5 `packages/engine/test/vectors.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.js';

const dir = join(import.meta.dirname, '../../../test-vectors/engine');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

// Compare instants, not strings: the vectors use +11:00 offsets, the engine returns UTC.
const instant = (s: string | null) => (s === null ? null : Date.parse(s));

describe('time engine test vectors', () => {
  it('finds the vector files', () => {
    expect(files.length).toBeGreaterThanOrEqual(26);
  });

  for (const file of files) {
    const c = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    it(`${file}: ${c.name}`, () => {
      const r = evaluate(c);
      const e = c.expect;
      expect(r.locked).toBe(e.locked);
      expect(r.lockReason).toBe(e.lockReason);
      expect(r.remainingSec).toBe(e.remainingSec);
      expect(instant(r.nextLockAt)).toBe(instant(e.nextLockAt));
      expect(instant(r.reevaluateAt)).toBe(instant(e.reevaluateAt));
      expect(r.usedSec).toBe(e.usedSec);
      expect(r.overspendSec).toBe(e.overspendSec);
    });
  }
});
```

### 5.6 `.github/workflows/typescript.yml`

Add `- "test-vectors/**"` to **both** `paths:` lists (under `pull_request` and under `push`), directly after `- "web/**"`. Change nothing else in that file.

## 6. Detailed spec: the algorithm

Write `evaluate` exactly following these steps. All instants are epoch milliseconds; all durations are **seconds** (whole numbers). Periods are half-open: `[from, to)` includes `from`, excludes `to`.

**Step 1: key instants** (use luxon with `zone: input.tz`):

- `now` = `Date.parse(input.now)`.
- `dayStart` = local `date` at 00:00. `dayEnd` = local start of the **next** day (luxon: `.plus({ days: 1 }).startOf('day')`).
- `wakeAt` = local `date` at `day.wake`. `bedAt` = local `date` at `day.bedtime`, except `"24:00"` means `dayEnd`.
- Write a small helper `localMs(date, "HH:MM", tz)` for this. `"00:00"` gives `dayStart`.

**Step 2: periods.**

- morning = `[dayStart, wakeAt)`, allowed = `[wakeAt, bedAt)`, evening = `[bedAt, dayEnd)`.
- `periodOf(t)`: `t < wakeAt` → morning; else `t < bedAt` → allowed; else evening.

**Step 3: used time.**

- Turn each segment into `[start, end]` in ms, where `end` is `now` when `end` is null.
- `used(from, to)` = total length in seconds of the **union** of all segments after clipping each one to `[max(from, dayStart), min(to, now, dayEnd))`. Union means overlapping parts count once: sort by start, merge overlaps, add up merged lengths. Ignore pieces of zero or negative length. Use `Math.floor(ms / 1000)` once, on the total.
- `usedMorning = used(dayStart, wakeAt)`, `usedAllowed = used(wakeAt, bedAt)`, `usedEvening = used(bedAt, dayEnd)`.

**Step 4: grants.** Each grant belongs to `periodOf(Date.parse(createdAt))`. `grantSec(period)` = sum of `minutes * 60` over grants in that period.

**Step 5: allowance.** `allowanceLeft = day.allowanceMin * 60 + grantSec(allowed) − usedAllowed` (may be negative).

Helper: `capToDay(x)` returns `null` if `x` is null **or** `x >= dayEnd`, otherwise `x`.

**Step 6: state, by the period that contains `now`.**

If `now` is in **allowed**:
- `remainingSec = max(0, allowanceLeft)`
- `locked = allowanceLeft <= 0`
- `lockReason = locked ? 'out_of_time' : null`
- `nextLockAt = locked ? null : capToDay(min(now + remainingSec*1000, bedAt))`

If `now` is in **morning** or **evening** (call it P):
- `curfewLeft = grantSec(P) − (P is morning ? usedMorning : usedEvening)`
- `remainingSec = max(0, curfewLeft)`
- `locked = curfewLeft <= 0`
- `lockReason = locked ? (P is morning ? 'before_wake' : 'bedtime') : null`
- If locked: `nextLockAt = null`. Otherwise let `t = now + remainingSec*1000`:
  - P is morning **and** `t >= wakeAt`: `nextLockAt = allowanceLeft > 0 ? capToDay(min(wakeAt + allowanceLeft*1000, bedAt)) : wakeAt`
  - otherwise: `nextLockAt = capToDay(t)`

**Step 7: reevaluateAt** = the smallest of: `nextLockAt` (if not null), `wakeAt` if `now < wakeAt < dayEnd`, `bedAt` if `now < bedAt < dayEnd`, and `dayEnd`.

**Step 8: result.**

- `usedSec = usedMorning + usedAllowed + usedEvening`
- `overspendSec = max(0, −allowanceLeft)`
- `nextLockAt` and `reevaluateAt` as `new Date(ms).toISOString()` (or `null`).

Example to check your understanding (vector `015-bedtime-grant.json`): bedtime 20:30, a 15-minute grant created at 21:00 (evening, so a curfew grant), the device in use since 21:01, now 21:10. usedEvening = 9 min = 540 s, curfewLeft = 900 − 540 = 360 s, not locked, nextLockAt = 21:16, usedSec = 540, overspendSec = 0 (allowance untouched).

## 7. Steps

1. Update and branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-003-time-engine-ts
   ```
2. Check the vectors are there: `(Get-ChildItem test-vectors\engine\*.json).Count` must print `26`.
3. Create the files in section 5 (exact contents where given).
4. `pnpm install` (adds luxon; updates `pnpm-lock.yaml`).
5. Write `src/engine.ts` following section 6.
6. `pnpm --filter @screentime/engine test`. Fix **your engine** until all 27 tests pass (26 vectors + 1 file-count test). Never edit a vector to make a test pass.
7. Edit `.github/workflows/typescript.yml` (section 5.6).
8. Run the full checks: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test`.
9. Commit, push, open the PR, then `gh pr checks --watch` until the check passes.

Tip if a vector fails: print the failing vector's file name and your result next to `expect`, and re-read the matching step in section 6. The usual mistakes are: forgetting to clip segments to `now`, adding overlapping segments twice, putting a grant created exactly at bedtime into the wrong period (exactly at bedtime = evening), and using local times without the time zone.

## 8. Acceptance criteria

- [ ] `pnpm --filter @screentime/engine test` shows `Tests  27 passed (27)`.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass for all three packages.
- [ ] `git diff --name-only main...HEAD` shows only: the 5 files under `packages/engine/`, `.github/workflows/typescript.yml` and `pnpm-lock.yaml`.
- [ ] No file under `test-vectors/` changed.
- [ ] The PR check `TypeScript / typecheck and test` passes.

## 9. Tests

Only `packages/engine/test/vectors.test.ts` (section 5.5). Do not add extra tests in this card.

## 10. Git and pull request

1. Commits, for example: `CARD-003: add engine package skeleton`, `CARD-003: implement time engine`, `CARD-003: run test vectors in CI`.
2. Push: `git push -u origin bob/card-003-time-engine-ts`
3. Write the PR body to `$env:TEMP\pr-body.md` (outside the repo) and run:
   ```powershell
   gh pr create --base main --head bob/card-003-time-engine-ts --title "CARD-003: Time engine in TypeScript" --body-file $env:TEMP\pr-body.md
   ```
   Body:
   ```markdown
   ## Card
   docs/cards/CARD-003-time-engine-ts.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] engine tests 27 passed — output: `...`
   - [x] build / typecheck / test pass — output: `...`
   - [x] only the expected files changed — output of git diff --name-only: `...`
   - [x] no test-vectors changes
   - [x] CI check passes — output of gh pr checks: `...`

   ## Deviations from the card
   None.

   ## Blockers / questions
   None.
   ```
4. `gh pr checks --watch`
5. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.
