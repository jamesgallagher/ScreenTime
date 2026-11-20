---
description: Write the handback report for a card, e.g. /handback 067
---
Write the handback report for CARD-$1 exactly as section 11 (or 12) of the card says, inside one fenced code block, as your last message to James.

These facts come from git, so copy them as they are:

- Branch: !`git branch --show-current`
- Head commit: !`git rev-parse HEAD`
- Files changed: !`git diff --name-only main...HEAD`
- Uncommitted changes (should be none): !`git status --short`
- PR: !`gh pr view --json url --jq .url`

Rules (AGENTS.md rule 9 and "Tests that prove the card"):

- Every command line shows the real output you saw **in this session**, copied. Test totals are the numbers the runner printed, not a sum you worked out.
- Anything you did not run is `NOT RUN: <reason>`. Never write the card's expected output as if you saw it.
- For an emulator, Sandbox or device run, paste every step's real output, or the whole results file the card names.
- Deviations list every way the work differs from the card, every workaround (restart, retry, extra script), and every existing test whose check you changed.
- If there are uncommitted changes above, stop and commit or explain them first.
