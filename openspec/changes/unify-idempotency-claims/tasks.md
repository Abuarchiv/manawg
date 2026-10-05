## 1. Helpers

- [ ] 1.1 Add `lockClaimedResponse` and a lease-checked `completeClaimedResponse` to `core/db/claimed-response.ts` next to the existing `releaseClaimedResponse`; unit-test missing, expired, foreign, completed and claimed rows.
- [ ] 1.2 Adapt the three existing callers of the boolean `completeClaimedResponse` (pinnwand, inventory, shopping duplicate path).

## 2. Non-financial routes

- [ ] 2.1 Chores create, chore completion (drop the redundant pre-transaction read), absences, events, calendar subscription, chat messages, WG create; one commit per route with its replay tests green.
- [ ] 2.2 Shopping create: replace the unconditional upsert with lock + complete; add a test for a same-key retry after a lease reclaim with `bought: true`.

## 3. Financial routes

- [ ] 3.1 Expenses create (both lock sites), recurring create, import commit; release after every confirmed rollback, not only listed codes.
- [ ] 3.2 Run `expense-integrity`, `expense-idempotency-retry` and `import-export` e2e specs after each step.

## 4. Verification

- [ ] 4.1 `rg "_claimed"` outside `core/db/claimed-response.ts`, `core/idempotency-store.ts` and tests returns nothing.
- [ ] 4.2 Lint, typecheck, unit tests, build and the full fixture e2e suite pass; record exact results in the PR.
