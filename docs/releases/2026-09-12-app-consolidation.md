# App consolidation — 2026-09-12

## Working directory

Use `/Users/abu/Company/manawg-app` on `main` for app work. Historical development states remain in Git; extra working directories are not archives.

## Preserved work

- Main checkout heading correction and planning: `389e729`, `daf3371`.
- Approved mobile interface history: merge `e8e69df`.
- Product experience, accounting protections and draft handling: merge `ca85586`.
- Previously uncommitted Start overview and dismissible hints: `eb8295e`, merge `735bddc`.

The current Start composition supersedes the earlier alternative onboarding/statistics layout. Canonical balance calculation, reviewed settlement scope, explicit draft replacement, monthly chore recurrence and persisted membership departure remain in the integrated implementation. Older planning variants remain recoverable through Git.

## Merge verification

Independent source review covered 18 conflicted settings, household and finance files. Review corrections preserve asynchronous error/retry dialogs, deferred form focus and links from settlement review to original expenses.

Node 22.23.2 and pnpm 9.0.0 used. Lint/typecheck, 13 Start/balance/release checks, feature-boundary and analytics checks, and all 11 strict OpenSpec validations passed. The built fixture bundle passes the original budgets: shared first-load JavaScript 101.6 KiB against 120 KiB.

The full fixture run executed all 278 cases: 244 passed, 23 hosted-only cases skipped, 11 failed. The failures were investigated rather than suppressed. Most were obsolete UI selectors, modal-transition readiness, or fixed-date test data; integration fixes also restored single-location chore errors and successful completion status announcements using the existing ActionNoticeBanner.

Targeted reruns covered every failed case: 37 product/shopping checks (34 passed, 3 requiring further correction); 58 chore/product/core-flow checks (57 passed, one modal-close readiness correction); final rebuilt checks for confirmed chore responsibility and both settlement cases (3 passed). Thus all 255 local cases have passing coverage across the full run and the relevant reruns; this does not claim a subsequent single all-green full-suite run. Assertions on amounts, reviewed records, payer identity, drafts and write counts remain intact.

The temporary verification config bounded action/navigation waits to 10 seconds for reruns. It was removed after verification; no extra test framework or permanent test configuration was added.

All four extra app worktrees are removed. `git worktree list` contains only `/Users/abu/Company/manawg-app`, on `main`; feature branches remain as history. Preserved local helper reports are in the main checkout's ignored tooling folders. Root README and NOTES now identify the sole working directory. Local fixture checks do not prove hosted authentication, production data, uploads or delivery. No push or deployment was performed.
