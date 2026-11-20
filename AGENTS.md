# Rules for coding agents

This file is for any coding agent working in this repository (for example "Bob", the local coder LLM). Read it before starting a card. It is short on purpose: read it all.

## What this repo is

Screen Time: a self-hosted parental screen-time limiter. Monorepo with a TypeScript server and web app, an Android project (Kotlin) and a Windows solution (C#). The spec is `docs/SPEC.md`. Work is split into cards in `docs/cards/`; the order is `docs/BUILD-PLAN.md`.

## Work smart: read little, read the right files

The repo has about 750 files (1.5 MB of text). **You cannot hold it all, and trying makes you forget the card.** Never open folders file by file to "get context". Instead:

1. **Read the card, all of it**, then only the SPEC sections it lists (search `docs/SPEC.md` for the heading, e.g. `### 12.9`). The card names every file you need and an existing example of each kind of thing.
2. **Open the files the card names**, then only what they import that you must change or call. One existing example of a pattern is enough (a route, a test, a migration): copy its shape, not every file like it.
3. **Find, don't browse.** Use search (grep/glob) for a name, a route path or a table, and open the hit. Read a part of a long file (`Worker.cs` is 1,100 lines), not all of it.
4. **Keep the card open in your mind.** Before each commit, re-read the card's acceptance criteria and check the work against them, not against your memory of them.
5. **While working, run only the tests you touch** (commands below). Run the full suite once at the end, before pushing.

**Never read** (they are big, generated or irrelevant, and the card never needs them):

- Generated clients: `contract/openapi.json`, `android/core-model/src/main/kotlin/au/screentime/core/model/api/ApiModels.kt` and `ApiClient.kt`, `windows/src/ScreenTime.Core/Api/*.g.cs`. Change `packages/schemas` and run `pnpm contract` instead.
- Build output and caches: `node_modules`, `dist`, `build`, `bin`, `obj`, `.gradle`, `TestResults`, `windows/out`.
- `server/drizzle/meta/` (written by `db:generate`), `pnpm-lock.yaml`, images and fonts.
- Other cards in `docs/cards/` (only yours), unless your card names one as an example.

In OpenCode these are blocked by `opencode.jsonc` (reading them is refused). To see one generated type, search for its name: the search shows the line.

## Tools for a card (OpenCode)

- **`/card NNN`** starts or resumes a card: it shows the branch and changes, then has you read the card and list the files you will touch before opening anything.
- **`/review-card NNN`** runs the `card-reviewer` agent: a read-only check of the branch against the card's acceptance criteria. Run it before the handback and fix what it finds.
- **`/handback NNN`** writes the handback with the commit, branch, changed files and PR taken straight from git.
- **Skills** load when they fit: `server-route`, `db-migration`, `card-tests`, `sandbox-run`, `emulator-run` (in `.opencode/skills/`).
- **Limits** (`opencode.jsonc`): pushing to `main`, force-pushing, merging a PR, `Stop-Process -Name` and `taskkill /IM` are refused; editing generated files and secrets is refused.
- **Loop guard** (`.opencode/plugins/loop-guard.js`): the same call 3 times in a row, two calls taking turns, or 25 reads in a row are refused with a message; after 6 refusals in 10 minutes the turn is stopped. When it refuses, do something different: never retry the same thing.

## Where things are

| Area | Where | Notes |
|---|---|---|
| API schemas (zod, the source of the contract) | `packages/schemas/src/<area>.ts`, exported from `index.ts` | Field names camelCase; give each schema a `.meta({ id })` |
| Time engine (shared maths) | `packages/engine`, `android/core-time`, `windows/src/ScreenTime.Core/Time` | All three pass `test-vectors/engine/`. Never change one alone |
| Server routes | `server/src/<area>/routes.ts` (e.g. `apps`, `reports`, `games`), registered in `server/src/app.ts` | Parent routes use `requireFamilyParent` (`server/src/auth/guards.ts`), device routes `requireDevice` (`server/src/devices/auth.ts`); read inside `withFamily(...)` (`server/src/db/family.ts`) |
| Database | `server/src/db/schema.ts`, migrations `server/drizzle/NNNN_*.sql` | New table: copy `0009_device_games.sql` (RLS + `family_isolation` policy) |
| Server jobs, pushes | `server/src/jobs/sweep.ts`, `server/src/notify/`, `server/src/live/` | |
| Server tests | `server/test/<area>.test.ts`, helpers in `server/test/helpers.ts` (`client`, `resetDatabase`, `testConfig`, `TEST_SECRET`) | Need `TEST_DATABASE_URL` (see Commands) |
| Dev scripts | `server/scripts/dev-*.ts` (grant, enrol code, parent mode, apps, report…) | Development database only |
| Parent web app | `web/src/lib/` (data and pure helpers), `web/src/pages/`, `web/src/components/` | Front end is Claude's (rule 10) |
| Web tests | `web/test/<name>.test.ts` | |
| Android kid app | `android/app-kid/src/main/kotlin/au/screentime/kid/<area>/` (`service/KidService.kt`, `apps/`, `admin/Policies.kt`, `sync/`) | Tests in `android/app-kid/src/test/` |
| Android parent app | `android/app-parent/src/main/kotlin/au/screentime/parent/` | Screens are Claude's |
| Android shared | `android/core-model` (generated API client), `android/core-ui` (theme) | |
| Windows pure logic | `windows/src/ScreenTime.Core/<area>/` (`Service/PipeMessage.cs`, `Store/LocalStore.cs`, `Sync/`, `Games/`) | Put logic here so it can be unit tested |
| Windows service | `windows/src/ScreenTime.Service/Worker.cs` (sessions, pipe, sync), `Program.cs` (flags) | Native AOT: JSON needs the source-generated contexts |
| Windows tray | `windows/src/ScreenTime.Tray/` (`TrayPipe.cs`, `App.xaml.cs`) | WPF |
| Windows tests | `windows/tests/ScreenTime.Core.Tests/<Name>Tests.cs` | xUnit |
| Windows Sandbox runs | `windows/installer/sandbox/Test-*.ps1` with `in-sandbox-*.ps1` | Copy the one your card names |
| Guides, deploy | `docs/guides/`, `deploy/` | |

## How to work

1. Do **exactly one card** per branch and pull request. The card file is the instruction; `docs/SPEC.md` is background.
2. Branch from the latest `main` as `bob/card-NNN-<slug>`.
3. Never push to `main`. Never merge a pull request. Never force-push to someone else's branch.
4. Do only what the card asks. Do not refactor unrelated code, rename things, upgrade dependencies or add features the card does not mention.
5. If the card is unclear or wrong, stop and write the question in the PR under "Blockers / questions". Do not invent a different design.
6. Run every acceptance command before pushing, and paste the key output into the PR body.
7. Never commit secrets (`.env`, keys, tokens, `google-services.json`, keystores). Use `.env.example` style files with placeholder values.
8. Put every temporary file (a PR body, scratch output, downloads) in `C:\Users\james\OpenCode\Testing\temp\`, never in `$env:TEMP` or `AppData\Local\Temp`. Create the folder if it is missing. It sits next to the repo, so nothing in it gets committed.
9. When the PR is open, finish with the card's **handback report** (section 11 or 12 of every card) as your last message to James. Report only what you actually ran and saw; write `NOT RUN` for anything you did not run. For an emulator, Sandbox or device run, paste the **real output of every step** (every `Screen-Text`, helper and script line), not a summary and not "the screenshots are the evidence": a step without its pasted output counts as `NOT RUN`, and Claude sends the PR back. Every workaround you used (a force-stop, a restart, an extra script, a retry) is a deviation: list it with why you needed it.
10. **Front-end files are Claude's.** When a card says Claude built the UI (the screens, icons and the seam they listen to), do not change those files, even to fix something: write it under "Blockers / questions" instead.
11. **Never open, focus or close programs on James's own desktop**, and never `Stop-Process` by name on his PC. Runs that need a Windows desktop happen in Windows Sandbox; runs that need Android happen on the emulator.

## Tests that prove the card

Claude re-runs your tests, breaks your code on purpose and reads the database. Tests that only agree with your own code get the PR sent back. So:

- **Write each acceptance criterion as its own test, with the card's inputs and expected numbers exactly.** If you cannot make a criterion pass, leave the test as the card says, failing, and ask under "Blockers / questions". Never change the expected value to match what your code does.
- **Fixed inputs only**: fixed dates and times, never "now minus 2 hours" (it breaks just after midnight). When a test needs a fixed date, also fix the family time zone (e.g. `UTC`).
- **Changing what an existing test checks is a deviation**: list it in the handback.
- **Break it yourself**: when the card has a "break it" criterion, change each named line, run the test, paste the failure, and restore with `git checkout -- <file>`.
- **Paste the totals the test runner prints.** Do not add them up yourself.
- **The tools you need exist on this PC**: the Android emulator (Android Studio's `Medium_Phone_API_37.0`), Windows Sandbox (turned on), Docker Desktop. "Not available" is not a reason to skip a run; if one really fails to start, paste the error.

## Conventions

- **Line endings:** LF everywhere except `.sln`, `.bat`, `.cmd` (handled by `.gitattributes`).
- **Indentation:** 2 spaces for TypeScript, JSON, YAML, Markdown; 4 spaces for Kotlin, C#, XML (see `.editorconfig`).
- **Encoding:** UTF-8 without a BOM. Use PowerShell 7 (`pwsh`), never Windows PowerShell 5.1 (it writes a BOM and mangles `§`).
- **TypeScript:** ESM only (`"type": "module"`), `strict` on, relative imports end in `.js` (for example `import { app } from './app.js'`). Package names are `@screentime/<name>`.
- **Names:** API JSON fields are camelCase; database columns are snake_case.
- **Time:** store and send instants in UTC ISO 8601. Local dates and times always use the family time zone, converted through the zone (never "add 24 hours").
- **Tests:** every card that adds logic adds tests. TypeScript uses Vitest; Kotlin uses JUnit 6 (Jupiter API); C# uses xUnit.
- **Commits:** `CARD-NNN: <what changed>`.

## Commands

Run from the repo root in `pwsh`.

```powershell
pnpm install       # install all workspace packages
pnpm build         # build every package
pnpm typecheck     # type-check every package
pnpm test          # build, then run all tests (server tests need TEST_DATABASE_URL below)
pnpm dev:server    # run the API on http://localhost:8080 (needs DATABASE_URL, see deploy/README.md)
pnpm dev:web       # run the parent web app on http://localhost:5173 (passes /v1 to the API on :8080)
pnpm contract      # regenerate contract/openapi.json and the Kotlin and C# clients after changing routes or schemas
```

The test database (once per terminal):

```powershell
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
$pw = (Select-String -Path deploy\.env -Pattern '^POSTGRES_PASSWORD=(.*)').Matches[0].Groups[1].Value
$env:TEST_DATABASE_URL = "postgres://screentime:$pw@localhost:5432/screentime_test"
```

Just the tests you are working on (fast; use these while working):

```powershell
pnpm --filter @screentime/server exec vitest run test/reports.test.ts
pnpm --filter @screentime/web exec vitest run test/reports.test.ts
cd windows; dotnet test --filter "FullyQualifiedName~ProgramsTests"; cd ..
cd android; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat :app-kid:testDebugUnitTest --tests "*UploadDaysTest*"; cd ..
```
