---
description: Start or resume a card, e.g. /card 067
---
You are working on card CARD-$1 in this repository. Where things stand now:

- Branch: !`git branch --show-current`
- Last commit: !`git log --oneline -1`
- Uncommitted changes: !`git status --short`

Do this, in order, and do not skip ahead:

1. Find the card with a file search for `docs/cards/CARD-$1-*.md` and read **all** of it. It is the instruction; AGENTS.md (already loaded) holds the rules.
2. Read only the `docs/SPEC.md` sections the card lists (search for their headings).
3. If you are not on the card's work branch, follow the card's "Git and pull request" steps to create it from the latest `main`. If you are already on it with changes, carry on from there: never reset or discard them.
4. Before opening any other file, write a short list: every file you will create or change, and the one existing example you will copy for each kind of change (the card names most of them). Then open only those.
5. Work through the card's design section. After each part, run only the tests you touched (AGENTS.md "Commands").
6. Before each commit, re-read the card's acceptance criteria and check the work against them.

When everything is done, run `/review-card $1` before writing the handback, then `/handback $1`.
