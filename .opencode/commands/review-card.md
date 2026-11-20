---
description: Check the branch against a card's acceptance criteria before the handback, e.g. /review-card 067
agent: card-reviewer
subtask: true
---
Review the work on this branch against card CARD-$1 (find it with a file search for `docs/cards/CARD-$1-*.md`).

Files changed against main: !`git diff --name-only main...HEAD`
Uncommitted changes: !`git status --short`
