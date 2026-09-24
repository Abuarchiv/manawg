## 1. Cache WG Reads

- [x] 1.1 Add a focused regression test showing cached shopping content remains visible while a revisit's GET is pending; attempt it in fixture mode and record the server-bind blocker if the harness cannot start.
- [x] 1.2 Add the URL-keyed in-memory `useCachedFetch` hook and migrate reads in the nine requested routes; verify web `tsc --noEmit` and targeted Biome, then run the regression and existing offline queue/draft tests under final gates.
- [ ] 1.3 Commit point 1 as `feat: cache WG page reads`; verify the commit contains only the cache point, its regression coverage, and the OpenSpec artifacts.

## 2. Optimistic Actions

- [x] 2.1 Add a chore-completion failure-path regression; attempt it in fixture mode and record the server-bind blocker when the harness cannot start.
- [x] 2.2 Add optimistic updates and rollback feedback to chore completion, expenses, subscriptions, calendar events, and reminders; verify web `tsc --noEmit` and targeted Biome, then run existing offline/mutation tests under final gates.
- [ ] 2.3 Commit point 2 as `feat: add optimistic WG actions`; verify the diff is limited to the requested mutations and coverage.

## 3. WG Navigation

- [x] 3.1 Add the WG subpage skeleton, explicit link prefetch, and 120 ms reduced-motion-aware opacity transition; verify TypeScript/build and record the blocked browser runtime check.
- [ ] 3.2 Commit point 3 as `feat: smooth WG page navigation`; verify only navigation files and its contract exception are included.

## 4. Touch Feedback

- [x] 4.1 Add 80 ms active feedback to the shared button and tappable list/card surfaces, with reduced-motion handling and preserved 44 px targets; verify targeted Biome and record the blocked mobile runtime check.
- [ ] 4.2 Commit point 4 as `feat: add responsive tap feedback`; verify only shared touch-feedback files and related coverage are included.

## 5. Thumb-Reachable Actions

- [x] 5.1 Move or surface exactly one existing primary action above the fixed navigation on each requested WG page; lead ausgaben with its balance/settlement card; check the 320 px and 390 px light/dark views when a browser runtime is available.
- [ ] 5.2 Commit point 5 as `feat: move WG actions within thumb reach`; verify only action placement and its viewport coverage are included.

## 6. Final Gates

- [ ] 6.1 Run `pnpm lint`, web `tsc --noEmit`, the existing tests, the web build, and OpenSpec validation; record exact results and review all five commits.
