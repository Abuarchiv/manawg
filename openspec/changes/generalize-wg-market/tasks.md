## 1. General market model

- [x] 1.1 Remove the student-count denominator from the market-capacity calculation and verify a non-student WG scenario uses the aggregate ceiling.
- [x] 1.2 Add the broad WG audience categories to the versioned snapshot and broaden channel labels; verify students remain a reference input and no unsupported numeric segment sizes are added.
- [x] 1.3 Surface the audience categories and general-capacity evidence in the JSON/Markdown result; verify stale and assumed evidence remains visible.

## 2. Verification and scheduler handoff

- [x] 2.1 Extend the self-check for general capacity, student-reference preservation, and deterministic replay; verify it passes.
- [x] 2.2 Run the live refresh and simulator, then verify lint, typecheck, build, OpenSpec strict validation, and diff cleanliness without touching existing application changes.
