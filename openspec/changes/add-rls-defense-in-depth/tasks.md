## 1. Catalog contract

- [x] 1.1 Record the exact audited public app-table set for Preview and Production and confirm the current baseline has no RLS, client grants, policies, or public executable functions.
- [x] 1.2 Define the checker contract for expected RLS coverage, migration-ledger prefix/order, and fail-closed unexpected table/access drift.

## 2. Forward migration and verifier

- [x] 2.1 Add one forward migration that enables RLS on the audited table set and changes no grants, policies, functions, or data.
- [ ] 2.2 Extend the existing migration verifier with the exact catalog assertions and verify its permissive/adoption modes remain unchanged; re-check the post-fix legacy-prefix rejection with Terra before closing this task.
- [x] 2.3 Run Node 22 source gates, migration SQL validation, and diff checks without applying the migration to an unauthorized environment.

## 3. Release rehearsal

- [ ] 3.1 Apply and verify the migration in Preview under release/database ownership; retain catalog and direct anonymous/authenticated client-denial evidence.
- [ ] 3.2 Run the required application fixture and protected Preview gates against the rehearsed build and verify no server-side route regression.
- [ ] 3.3 Promote to Production only after the Preview handoff, exact ledger/RLS/access checks, and Terra review are green; record rollback readiness and leave the task open if any external evidence is missing.
