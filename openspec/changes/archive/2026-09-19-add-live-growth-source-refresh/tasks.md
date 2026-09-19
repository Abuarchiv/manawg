## 1. Refresh implementation

- [x] 1.1 Add the allowlisted Node refresh command, scalar extraction, bounded
  fetch, atomic dated outputs, and package script.
- [x] 1.2 Pass source-refresh metadata through simulator JSON and Markdown
  outputs.
- [x] 1.3 Extend the self-check for refresh updates, fail-closed parsing, and
  baseline preservation.

## 2. Scheduler and verification

- [x] 2.1 Point the existing 15-minute OpenClaw loop at refresh then simulation
  using the same UTC date.
- [x] 2.2 Run the live refresh and simulator, then verify self-check, lint,
  typecheck, build, and OpenSpec validation.
