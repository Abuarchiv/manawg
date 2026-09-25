## 1. Establish the durable deletion boundary

- [x] 1.1 Confirm the implementation starts from PR #428's reviewed SHA or an explicitly reconciled successor, inspect existing WIP and migration ordering, and verify the diff contains no unrelated author changes before editing.
- [x] 1.2 Add the minimal `account_deletions` schema and generated additive migration with lifecycle/attempt timestamps, RLS, and restricted Data API privileges; verify it on a disposable migrated database and prove anonymous/authenticated roles cannot read or write it.
- [x] 1.3 Implement one namespaced account advisory-lock/fence check used by deletion and membership acquisition; prove with two DB connections that a committed acquisition is included in deletion and a request waiting behind deletion cannot acquire a membership.
- [x] 1.4 Commit the fence, local cleanup, and corresponding departure audit changes atomically; inject rollback and uncertain-commit outcomes and verify no Auth deletion occurs without a subsequently confirmed committed fence, while retries do not repeat local destruction.

## 2. Serialize membership and WG lifecycle decisions

- [x] 2.1 Add the account fence before existing idempotency/WG/member locks in WG create, join, and legacy claim; test each route with an already authenticated request resumed after cleanup, including a different WG and an existing replay key.
- [x] 2.2 Change account cleanup to discover WG IDs without member locks, acquire sorted parent locks, and reread memberships before successor/solo decisions; reproduce join-first and delete-first interleavings with two connections and assert no successfully joined member is cascaded away.
- [x] 2.3 Move member activation/deactivation and whole-WG deletion authority checks inside their parent-locked transaction; test a successor moving out and an in-flight former-admin WG deletion, proving current roles are enforced after waiting for locks.
- [x] 2.4 Verify simultaneous account deletions across multiple shared WGs, deterministic successor selection, the one-admin uniqueness constraint, and unchanged other-member financial rows/balances; fix any lock inversion exposed by the test rather than weakening assertions.

## 3. Close calendar and notification access

- [x] 3.1 Revoke/delete calendar subscriptions together with push cleanup and restrict public feeds to active, Auth-linked members; verify the original calendar URL is rejected after cleanup while another member's feed still returns the expected events.
- [x] 3.2 Carry the originally verified account ID into calendar mutation transactions, acquire the WG lock before member/credential writes, and revalidate ownership/activity before creation, rotation, or replay; test a paused credential request resumed after deletion cannot restore usable access.
- [x] 3.3 Apply the same parent-lock and fresh-member checks to notification writes that can subscribe or re-enable push; verify a previously authenticated subscribe/preferences request cannot recreate access after detachment and normal subscription replay still works.

## 4. Complete Auth deletion and recover failures truthfully

- [x] 4.1 Implement one bounded Auth-completion operation outside DB transactions, marking completion only for success or an explicitly verified user-not-found result; test timeout, permission failure, arbitrary 404, explicit absence, and success followed by a failed completion write.
- [x] 4.2 Reuse that operation in the authenticated maintenance cron with bounded, fair least-recently-attempted batches and visible pending/failure counts; prove repeated failures do not starve newer requests and existing idempotency-housekeeping failure does not suppress deletion recovery.
- [x] 4.3 Return structured HTTP 200 completed versus HTTP 202 pending outcomes from the account route; verify committed cleanup remains fenced through provider failure and duplicate route/cron attempts do not repeat WG cleanup or audit entries.
- [x] 4.4 Update the deletion UI to handle accepted and completed outcomes, retain explicit confirmation, announce pending status, and isolate sign-out/storage errors from the server outcome; verify 200, 202, pre-commit error, and unavailable localStorage in component/browser tests, including keyboard focus and light/dark 320px layout.

## 5. Verify the integrated candidate and hand off evidence

- [x] 5.1 Run the deletion regression matrix on an explicitly disposable database with applied migrations and controlled Auth transport; verify all race tests use independently scheduled connections/barriers rather than sleeps or only sequential mocks.
- [x] 5.2 Run Node 22/pnpm 9 lint, typecheck, unit tests, build, relevant fixture E2E, `git diff --check`, and `openspec validate harden-account-deletion --strict`; record exact commands/results and resolve failures without reducing the acceptance contracts.
- [ ] 5.3 After application code changes, update the knowledge graph with `graphify update .` and obtain an independent review of authorization, lock order, rollback/retry behavior, and retained data; verify every actionable finding is resolved on the final candidate SHA.
- [ ] 5.4 Record exact-SHA hosted Preview migration/Auth checks and any external blockers separately from local evidence; verify service-role availability and the provider's missing-user behavior without exposing credentials, and keep the PR open if required Preview/Auth/RLS gates remain failed.

## Verification record (2026-09-25)

- Node-dependent application checks used Node v22.23.2 and pnpm 9.0.0 (`PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin`).
- `pnpm --dir apps/web run typecheck` — passed.
- `pnpm --dir apps/web run lint` — passed; Biome checked 518 files and feature-boundary checks passed for 7 features.
- `pnpm --dir apps/web run test:unit` — passed.
- `ACCOUNT_DELETE_TEST_URL='postgresql://postgres@127.0.0.1:55432/manawg_test' pnpm --dir apps/web exec playwright test e2e/account-delete-db.spec.ts e2e/account-delete-ui.spec.ts` — passed against the disposable local PostgreSQL database.
- `pnpm --dir apps/web run build` — passed.
- `git diff --check` and `openspec validate harden-account-deletion --strict` — passed.
- `graphify update .` — passed.
- Fresh PostgreSQL 17 database `manawg_account_delete_replay_20260925`: the repository `drizzle/` journal replayed all 16 migrations with Drizzle's Node PostgreSQL migrator. `account_deletions` has RLS enabled; `anon` and `authenticated` have no SELECT/INSERT/UPDATE/DELETE table privileges.
- The product `db:migrate` runner refused the local port-55432 URL with its existing direct-Supabase-port-5432 guard. The guard was left unchanged; the isolated Drizzle migrator was used for the local replay.
- Final independent review of the test commit is pending (5.3). Hosted exact-SHA Preview/Auth checks are unverified (5.4); no hosted or production system was changed.
