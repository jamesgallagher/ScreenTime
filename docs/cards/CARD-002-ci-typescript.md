# CARD-002: CI for TypeScript

| Field | Value |
|---|---|
| Card | CARD-002 |
| Title | CI for TypeScript |
| Size | S |
| Depends on | CARD-001 (merged to `main`) |
| Spec sections | docs/SPEC.md §4.1 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-002-ci-typescript` |
| PR title | `CARD-002: CI for TypeScript` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

CARD-001 created the pnpm workspace (`packages/schemas`, `server`) with the root scripts `pnpm typecheck` and `pnpm test`. There is no CI yet.

## 2. Goal

Every pull request and every push to `main` that touches the TypeScript parts runs a GitHub Actions job that installs dependencies from the lockfile, type-checks and runs all tests. The job must pass on this card's own PR.

## 3. Out of scope

- No Android, Windows or Docker jobs (later cards add their own workflows).
- No linting or formatting tools (no ESLint, Prettier).
- No deployment, releases or caching beyond what `actions/setup-node` does.
- No branch protection settings (James sets those in GitHub if he wants them).
- Do not change any file outside `.github/`.

## 4. Tech and versions

| Item | Value |
|---|---|
| GitHub Actions runner | `ubuntu-latest` |
| `actions/checkout` | `v5` |
| `pnpm/action-setup` | `v4` (reads the pnpm version from `packageManager` in the root `package.json`; do **not** give it a `version`, or it fails with a version conflict) |
| `actions/setup-node` | `v5`, Node version read from `.nvmrc` (which contains `24`) |
| pnpm | 11.x, from `packageManager` |

Local tools needed: the same as CARD-001 (Git, `gh` logged in, Node 24, pnpm 11).

## 5. Files

Create exactly one file.

### 5.1 `.github/workflows/typescript.yml`

```yaml
name: TypeScript

on:
  pull_request:
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
      - ".github/workflows/typescript.yml"
  push:
    branches: [main]
    paths:
      - "packages/**"
      - "server/**"
      - "web/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.base.json"
      - ".nvmrc"
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
```

Notes:

- `pnpm build` runs before `pnpm typecheck` because the server imports `@screentime/schemas` from its built `dist/` folder.
- `--frozen-lockfile` makes the job fail if `pnpm-lock.yaml` is out of date, which is what we want.
- Indentation is 2 spaces. YAML is sensitive to indentation: copy the block exactly.

## 6. Detailed spec

- Workflow name `TypeScript`, job id `check`, job name `typecheck and test`. On a PR this shows as the check **"TypeScript / typecheck and test"**.
- It runs on pull requests and on pushes to `main`, but only when one of the listed paths changed. A docs-only PR does not run it.
- The workflow file itself is in the path list, so this card's PR triggers it.

## 7. Steps

Run in PowerShell in `C:\Users\james\OpenCode\Testing\ScreenTime`.

1. Update and branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-002-ci-typescript
   ```
2. Create `.github\workflows\typescript.yml` with the exact contents of section 5.1.
3. Run the same commands locally to make sure they pass:
   ```powershell
   pnpm install --frozen-lockfile
   pnpm build
   pnpm typecheck
   pnpm test
   ```
4. Commit: `git add .github/workflows/typescript.yml` then `git commit -m "CARD-002: add TypeScript CI workflow"`.
5. Push and open the PR (section 10).
6. Wait for the check and read its result:
   ```powershell
   gh pr checks --watch
   ```
   If the check fails, run `gh run view --log-failed`, fix the cause **within `.github/workflows/typescript.yml` only**, commit, push, and watch again. If the fix would need a change outside that file, stop and write it under "Blockers / questions" in the PR.

## 8. Acceptance criteria

- [ ] `git diff --name-only main...HEAD` lists exactly one file: `.github/workflows/typescript.yml`.
- [ ] Local `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm test` all pass.
- [ ] On the PR, `gh pr checks` shows `TypeScript / typecheck and test` as **pass**.
- [ ] The job log shows `Tests  3 passed (3)` for `packages/schemas` and `Tests  2 passed (2)` for `server`.

## 9. Tests

No new tests. The workflow runs the existing 5 tests.

## 10. Git and pull request

1. Push: `git push -u origin bob/card-002-ci-typescript`
2. Open the PR into `main` titled `CARD-002: CI for TypeScript`. Write the body to a file **outside** the repo (for example `$env:TEMP\pr-body.md`) and run:
   ```powershell
   gh pr create --base main --head bob/card-002-ci-typescript --title "CARD-002: CI for TypeScript" --body-file $env:TEMP\pr-body.md
   ```
   Body:
   ```markdown
   ## Card
   docs/cards/CARD-002-ci-typescript.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] only .github/workflows/typescript.yml changed
   - [x] local install/build/typecheck/test pass — output: `...`
   - [x] CI check passes — output of `gh pr checks`: `...`
   - [x] CI log shows 3 + 2 tests passed

   ## Deviations from the card
   None.

   ## Blockers / questions
   None.
   ```
3. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.
