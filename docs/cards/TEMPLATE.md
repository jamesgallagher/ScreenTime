# CARD-NNN: <Title>

> Copy this file to `docs/cards/CARD-NNN-<slug>.md` and fill every section. A card must be complete on its own: the coder has **no memory** of earlier cards or conversations. Repeat context rather than refer to it. Delete these quote blocks when done.

| Field | Value |
|---|---|
| Card | CARD-NNN |
| Title | <Title> |
| Size | S / M / L |
| Depends on | CARD-xxx (merged to `main`), or none |
| Spec sections | docs/SPEC.md §x.y |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-NNN-<slug>` |
| PR title | `CARD-NNN: <Title>` |

## 1. Project context

> Paste the standard paragraph below unchanged, then add anything this card needs.

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

## 2. Goal

> One or two sentences: what exists after this card that did not exist before.

## 3. Out of scope

> Bullet list of tempting things NOT to do in this card. Be explicit.

## 4. Tech and versions

> Exact languages, frameworks, packages and major versions. Say which tools must be installed on James's PC and how to check them (`node --version` etc.).

## 5. Files

> Every file to create or change, with its full path. For small or critical files give the exact contents in fenced code blocks. For larger files give the exact structure, names and behaviour.

## 6. Detailed spec

> Exact behaviour: endpoints, inputs, outputs, error cases, UI layout with sizes, colours (token names and hex), copy text, states. Copy the relevant parts of docs/SPEC.md here rather than only linking.

## 7. Steps

> Numbered steps in order, including the commands to run (PowerShell on Windows).

## 8. Acceptance criteria

> Checkboxes. Each one must be checkable by a command, a test, or a screenshot. Give the exact command and the expected output.

- [ ] ...

## 9. Tests

> Which automated tests to write, file names, and what each one asserts.

## 10. Git and pull request

1. Start from the latest `main`:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-NNN-<slug>
   ```
2. Commit in small logical commits. Message format: `CARD-NNN: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-NNN-<slug>`
5. Open a PR into `main` titled `CARD-NNN: <Title>` with this body:
   ```markdown
   ## Card
   docs/cards/CARD-NNN-<slug>.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] criterion 1 — output: `...`
   - [x] criterion 2 — output: `...`

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-NNN. Please review and merge if it is good.

CARD: CARD-NNN <title>
PR: <full PR URL>
Branch: bob/card-NNN-<slug>
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
