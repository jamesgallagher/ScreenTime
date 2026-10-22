# test-vectors

Shared JSON test cases for the time engine. The same files are run by the TypeScript engine (`packages/engine`), the Kotlin engine (`android/core-time`) and the C# engine (`windows/src/ScreenTime.Core`), so all three always agree on remaining time and lock state.

Format: docs/SPEC.md §7.4. The cases are written by the architect from the spec (computed with an independent reference implementation) and are the source of truth: implementations change to match them, never the other way round. Changes to a vector need a reviewed PR that also updates docs/SPEC.md §7 if the rule changed.
