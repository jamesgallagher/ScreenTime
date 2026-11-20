---
name: card-tests
description: How to write the tests for a Screen Time card so they prove the card, not just the code, and survive Claude's review. Use when writing or changing tests for a card's acceptance criteria.
---

# Tests that prove the card

Claude re-runs every test, breaks lines of the code on purpose, and checks the database. A test that only agrees with the code gets the PR sent back.

- **One test per acceptance criterion**, named after the behaviour, with the card's inputs and the card's expected numbers copied exactly. If the code gives another number, the code is wrong or the card is: leave the test as the card says and ask under "Blockers / questions". Never change the expected value.
- **Fixed inputs.** Fixed dates and times (`new Date('2026-11-10T10:00:00Z')`), never `Date.now()` minus something: such tests fail just after midnight. With a fixed date, fix the family time zone too (for example set it to `UTC` in the test).
- **Local days go through the time zone.** Include a daylight-saving case when the card has one (Australia/Sydney: 5 April 2026 is 25 hours, 4 October 2026 is 23).
- **Edge cases the card names**: nothing at all (no devices, no rows), removed things, the boundary itself (a segment across midnight).
- **Break it yourself.** For each line the card names, change it, run the test, see it fail, paste the failing test's name, and restore with `git checkout -- <file>`. If nothing fails, the test is too weak: fix the test, not the code.
- **Existing tests are the card's too.** Changing what an existing test checks is a deviation: list it in the handback.
- **Run what you touched** while working (single-file commands in AGENTS.md), the full suite once before pushing, and paste the totals exactly as the runner prints them.
- **Slow runs: once, to a file.** Send the output of `pnpm test`, Gradle or `dotnet test` to a file in `C:\Users\james\OpenCode\Testing\temp\` (`*> $out`, see AGENTS.md "Saving test output") and search that file for the totals and failures. Never re-run a passing suite only to filter its output differently; re-run only after changing code.
- **Server tests skip without `TEST_DATABASE_URL`** (`describe.skipIf(!url)`): check that yours ran.
