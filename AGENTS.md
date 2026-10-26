# Rules for coding agents

This file is for any coding agent working in this repository (for example "Bob", the local coder LLM). Read it before starting a card.

## What this repo is

Screen Time: a self-hosted parental screen-time limiter. Monorepo with a TypeScript server and web app, an Android project (Kotlin) and a Windows solution (C#). The spec is `docs/SPEC.md`. Work is split into cards in `docs/cards/`; the order is `docs/BUILD-PLAN.md`.

## How to work

1. Do **exactly one card** per branch and pull request. The card file is the instruction; `docs/SPEC.md` is background.
2. Branch from the latest `main` as `bob/card-NNN-<slug>`.
3. Never push to `main`. Never merge a pull request. Never force-push to someone else's branch.
4. Do only what the card asks. Do not refactor unrelated code, rename things, upgrade dependencies or add features the card does not mention.
5. If the card is unclear or wrong, stop and write the question in the PR under "Blockers / questions". Do not invent a different design.
6. Run every acceptance command before pushing, and paste the key output into the PR body.
7. Never commit secrets (`.env`, keys, tokens, `google-services.json`, keystores). Use `.env.example` style files with placeholder values.
8. Put every temporary file (a PR body, scratch output, downloads) in `C:\Users\james\OpenCode\Testing\temp\`, never in `$env:TEMP` or `AppData\Local\Temp`. Create the folder if it is missing. It sits next to the repo, so nothing in it gets committed.
9. When the PR is open, finish with the card's **handback report** (section 12 of every card) as your last message to James. Report only what you actually ran and saw; write `NOT RUN` for anything you did not run.

## Conventions

- **Line endings:** LF everywhere except `.sln`, `.bat`, `.cmd` (handled by `.gitattributes`).
- **Indentation:** 2 spaces for TypeScript, JSON, YAML, Markdown; 4 spaces for Kotlin, C#, XML (see `.editorconfig`).
- **TypeScript:** ESM only (`"type": "module"`), `strict` on, relative imports end in `.js` (for example `import { app } from './app.js'`). Package names are `@screentime/<name>`.
- **Names:** API JSON fields are camelCase; database columns are snake_case.
- **Time:** store and send instants in UTC ISO 8601. Local dates and times always use the family time zone.
- **Tests:** every card that adds logic adds tests. TypeScript uses Vitest; Kotlin uses JUnit 6 (Jupiter API); C# uses xUnit.
- **Commits:** `CARD-NNN: <what changed>`.

## Commands (TypeScript workspace)

Run from the repo root in PowerShell:

```powershell
pnpm install       # install all workspace packages
pnpm build         # build every package
pnpm typecheck     # type-check every package
pnpm test          # build, then run all tests
pnpm dev:server    # run the API on http://localhost:8080 (needs DATABASE_URL, see deploy/README.md)
pnpm dev:web       # run the parent web app on http://localhost:5173 (passes /v1 to the API on :8080)
pnpm contract      # regenerate contract/openapi.json after changing routes or schemas
```
