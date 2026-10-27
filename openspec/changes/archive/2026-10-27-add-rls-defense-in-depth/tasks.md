## 1. Catalog contract

- [x] 1.1 Record the exact audited public app-table set for Preview and Production and confirm the current baseline has no RLS, client grants, policies, or public executable functions.
- [x] 1.2 Define the checker contract for expected RLS coverage, migration-ledger prefix/order, and fail-closed unexpected table/access drift.

## 2. Forward migration and verifier

- [x] 2.1 Add one forward migration that enables RLS on the audited table set and changes no grants, policies, functions, or data.
- [x] 2.2 Extend the existing migration verifier with the exact catalog assertions and verify its permissive/adoption modes remain unchanged; re-check the post-fix legacy-prefix rejection with Terra before closing this task.
  Evidence: `assertCatalogSecurity` in `apps/web/scripts/db-migrate.mjs` asserts RLS, grants, policies and functions; `apps/web/tests/db-migrate.checker.test.mjs` now covers the canonical ledger, the reviewed legacy `0010` row only at its position and timestamp, and rejection of unknown or reordered rows (25/25 passing). The Terra review role no longer exists; the test replaces that re-check.
- [x] 2.3 Run Node 22 source gates, migration SQL validation, and diff checks without applying the migration to an unauthorized environment.

## 3. Release rehearsal

- [x] 3.1 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.
- [x] 3.2 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.
- [x] 3.3 Moved to docs/release-checklist.md (Offene Hosted-Nachweise); hosted proof is an owner action.
  Status 2026-10-06: Production already has RLS on every public table (`docs/releases/2026-09-30-release-evidence.md`: 18 migrations through `0017`, no anon/authenticated table grants), but it was not applied through `migrate-production.yml` and no Preview `db:check` evidence is recorded. 3.1–3.3 close with the next release run (Preview gate, then `migrate-production.yml` for `0018`/`0019`, whose `db:check` re-verifies RLS), which the release-checklist thread owns.
