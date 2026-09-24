## Context

See `proposal.md` for scope and motivation. The reviewed base is PR #428 at `a23bca8ad7f03db75e5bc7dd985efc8872c12543`.

- `core/db/delete-account.ts` locks the deleting account's member rows before selecting an unlocked successor; whole-WG deletion acquires its parent lock only when deleting the WG.
- Joining (`api/wg/[code]/members/route.ts`) and legacy claiming (`members/[id]/claim/route.ts`) already lock the WG first. Member PATCH reads authorization and role before an unguarded update.
- `api/account/route.ts` commits local cleanup and then calls Supabase Auth. `wg_members.auth_user_id` has no FK to `auth.users`; three routes can create or attach memberships during this gap.
- Calendar feed access checks the bearer subscription alone. Calendar and push credential writes authenticate before entering their mutation transaction.
- The existing maintenance cron runs daily at `45 4 * * *`. It can resume pending Auth deletion without adding a service or scheduler.
- Supabase `auth-js` 2.112.4 sends `getUser()` to `/user` and defaults `admin.deleteUser(id)` to hard deletion. Supabase documents that existing access JWTs are not retroactively invalidated, and Storage ownership can prevent Auth deletion. Do not replace server verification with locally decoded JWT claims.

## Goals / Non-Goals

**Goals:** Resolve the reviewed races with the existing transaction, guard, and cron infrastructure; make partial completion explicit; retain shared financial history; provide deterministic regression evidence.

**Non-Goals:** A general job framework, new Auth provider, universal rewrite of all WG mutations, financial anonymization, or a redesign of the existing explicit account-deletion confirmation. Object-storage retention and policy wording remain separate work; a provider-side blocker must remain pending and visible rather than being hidden.

## Decisions

### 1. One durable record is both the membership fence and recovery record

Add `account_deletions` with `auth_user_id uuid PRIMARY KEY`, `requested_at timestamptz NOT NULL DEFAULT now()`, nullable `completed_at`, and nullable `last_attempt_at`. The extra attempt timestamp allows bounded cron batches to rotate through failures without starving later requests. Do not add payloads, names, emails, error-message blobs, lease states, or an Auth-user FK.

Insert this record in the SAME transaction that detaches memberships and removes credentials. Its existence means local cleanup committed and the account can never acquire another membership. A null `completed_at` means Auth completion still needs confirmation. Keep the completed record as a minimal fence; automatic expiry is outside this change because it would require a proven bound on stale authenticated requests.

Enable RLS and revoke direct `anon`/`authenticated` privileges using the project's migration conventions. Only server/maintenance access is needed. Verify the migration against a disposable database and the Preview migration gates.

Rejected alternatives: an in-memory flag does not coordinate server instances; a transaction lock ends before the Auth call; deleting Auth first makes a subsequent database failure unrecoverable by the user; reusing expiring idempotency responses would eventually reopen the fence.

### 2. Serialize account membership acquisition before WG locks

Use one account-scoped PostgreSQL transaction advisory lock, derived deterministically from a namespaced account UUID, in deletion and all three acquisition paths. A hash collision only serializes unrelated accounts; it must never authorize access. No account-wide lock is taken after acquiring a WG lock.

Global order for paths using these resources:

```text
account advisory lock (when acquiring membership or deleting an account)
  -> existing idempotency row lock, if the path needs one
  -> existing WG rows in ascending UUID order
  -> member rows
  -> child records and updates
```

Creation, joining, and claiming check for a deletion record while holding that account lock INSIDE their mutation transaction, before any insert/link. Keep existing idempotency behavior for ordinary requests; a replay must not bypass a required deletion-state check or be used to restore access. A preliminary HTTP-level check is useful for an error message but is not the race barrier.

Deletion acquires its account lock, discovers candidate WG IDs without member locks, locks the existing WG rows in sorted order, then rereads the account's memberships and roles under those locks. A concurrent whole-WG deletion can remove a candidate before it is locked; reread and skip its missing membership rather than relying on the old snapshot. New membership acquisition for this account is blocked by the account lock.

Do not retain the original initial `wg_members FOR UPDATE` before the WG locks: two deleting accounts can each own a member row and deadlock while attempting a shared WG's admin transfer.

### 3. Revalidate every changed membership decision under the WG lock

Join and claim already use the parent lock; put the account fence before it. Member activation/deactivation PATCH must enter a transaction, lock the WG, and reread the caller's current membership/authority and the target's role/status before checking or updating them. Whole-WG DELETE must similarly revalidate its current admin inside its deletion transaction. The shared whole-WG helper acquires the parent lock before removing any child roots, including when called independently of account deletion.

Account deletion chooses the successor from the locked WG's current active roster, preferring an account-linked member, then `created_at`, with member ID as a deterministic tie-breaker. Demote/detach the old admin before promoting its successor, preserving the one-admin uniqueness constraint. Two account deletions that share WGs serialize on sorted parent locks; the second rereads the first one's result and performs the final correct handover or solo deletion.

### 4. Revoke credentials and prevent their recreation

Delete or revoke the departing member's `calendar_subscriptions` and delete `push_subscriptions` in local cleanup. Clear `paypal_merchant_id`, disable push, detach `auth_user_id`, and deactivate the member. Preserve its name and financial references in shared WGs as already disclosed in the feature.

Public calendar feed lookup must also require an active member that still has an Auth association. This makes an old token unusable even if a credential row remains because of older data or a separate defect.

Calendar subscription create/rotate/revoke and notification mutations that can restore opt-in or subscribe must lock the WG before member/credential writes and reread the active member and its Auth identity inside the transaction. Carry the originally server-verified account ID into this check; comparing only member ID or only non-null `auth_user_id` is insufficient if ownership changes. These paths do not need an account advisory lock if they take no account lock after the WG lock: the WG lock and fresh membership check serialize them with deletion. Preserve their existing replay atomicity and never return a replay as new usable access for a detached member.

### 5. Local cleanup commits before bounded, repeatable Auth deletion

Within local cleanup, insert the fence and audit changes together. A failed or uncertain DB commit must not trigger an unrecorded Auth deletion: retry by reading the fence under the account lock. Audit wording must describe the local departure/deletion request rather than asserting provider completion prematurely. An existing fence skips all destructive local work.

After a confirmed local commit, call `admin.deleteUser(accountId, false)` outside the transaction with a bounded request timeout. A successful deletion or an explicit structured `user_not_found` result permits setting `completed_at`. If the provider's exact missing-user contract is not confirmed by the installed SDK/provider test, use an admin lookup to distinguish explicit user absence from an HTTP routing error; never treat arbitrary 404, authorization failures, or timeouts as completion.

Use the same small completion function from the account route and existing authenticated maintenance cron. Record `last_attempt_at` on attempted completion. Process pending records in least-recently-attempted order (nulls first, then request time and UUID), with a fixed small batch and total/request time budgets fitting the route runtime. Concurrent attempts are acceptable: deleting the same UUID and recording completion are idempotent, so no lease framework is required. Pending and failed counts must remain visible in cron evidence without secrets or raw provider responses. Failure in existing idempotency housekeeping must not prevent the independent deletion-recovery work from being attempted, or vice versa.

Crash after local commit: cron finds the pending record. Crash after Auth success: retry observes explicit absence and marks completion. Auth outage or storage-ownership rejection: keep the fence and pending record, report the blocker, and retry later without pretending the deletion completed. Daily scheduling means recovery can take up to roughly 24 hours before its next automatic attempt; do not promise immediate provider completion.

### 6. Keep the API and browser outcome truthful

HTTP 200 means Auth completion is confirmed. HTTP 202 means local cleanup is committed and provider completion remains pending. Pre-commit failure remains a failure response with no accepted-deletion claim. Stable structured response states should distinguish these cases; existing successful callers need not depend on a deleted-WG count being reconstructed on retry.

Both 200 and 202 leave the private WG view and attempt local sign-out and ManaWG storage cleanup. Isolate browser cleanup errors from the server mutation outcome: a localStorage exception must not render "account could not be deleted" after acceptance. Preserve confirmation text, focus handling, accessible error/status announcement, 44px hit areas, and light/dark/320px layout. A missing original session must not block server-side retry; the maintenance record is the recovery authority.

## Implementation ownership and handoff graph

The root implementer owns shared state and integration. The planning worktree is based on the exact reviewed PR SHA; no application files are changed by this artifact task.

| Node | Inputs | Owner | Output and completion check |
| --- | --- | --- | --- |
| Contract and schema | This proposal/spec/design; current migrations | Implementer | Restricted fence table and disposable-DB rollback/RLS checks |
| Membership concurrency | Fence helper; existing three acquisition routes | Implementer | Account/WG/member lock order and two-connection tests |
| Credential closure | Locked membership contract; calendar/push routes | Implementer | Old feeds rejected; in-flight credential writes cannot restore access |
| Completion recovery and UI | Committed fence; Supabase admin contract | Implementer | 200/202 flow, lost-response recovery, bounded fair maintenance retries |
| Independent verification | Final exact candidate; all targeted evidence | Reviewer, then root | Findings resolved and required local/Preview gates reported separately |

Schema precedes callers; concurrency precedes credentials and recovery integration; the final review consumes the integrated candidate. A failed invariant returns to its owning node with the exact failing interleaving. Do not accept a test by loosening the invariant or report fixture evidence as hosted success.

## Risks / Trade-offs

- [Long-lived minimal account fence] -> Retain only UUID and lifecycle timestamps, restrict access, and document its access-revocation purpose; do not reuse it as an analytics profile.
- [WG locks serialize concurrent membership changes] -> Keep network/Auth calls outside locked transactions, acquire multiple WG locks in sorted order, and test realistic competing connections.
- [Provider deletion blocked indefinitely] -> Preserve pending state and operator-visible evidence; do not erase the fence or restore memberships automatically.
- [Supabase JWTs outlive deletion] -> Keep server `getUser()` verification, the persistent acquisition fence, revoked credentials, and active-member feed checks; do not claim JWT cryptographic revocation.
- [Shared history intentionally remains] -> Preserve balances and record the unchanged retention contract without claiming all personal content has been erased.

## Migration Plan

Generate the additive migration through the repository's existing migration tooling. Apply and verify the schema/RLS change on a disposable database before app tests; ship all fence-reading writers and deletion code as one candidate. Run Node 22/pnpm 9 local gates, then the established exact-SHA Preview migration/Auth gates. Production migration remains subject to the existing protected workflow.

The additive table can remain during rollback. Never drop or empty it after any deletion was accepted. A rollback must retain the fence checks and recovery path, or pause affected writes until a forward fix is deployed; rolling all the way back to unfenced membership writers is unsafe. If no deletion record has ever been created, an ordinary code rollback leaves the unused additive table harmlessly in place.

## Evidence and source limits

The architecture is based on code review of PR #428 and current shared callers/schema. Supabase behavior was checked against installed `@supabase/auth-js` 2.112.4 and [Managing user data](https://supabase.com/docs/guides/auth/managing-user-data). No live account, production data, or remote environment was mutated. Hosted provider-not-found behavior, configured runtime budgets, service-role availability, and exact-SHA Preview success remain implementation/release verification tasks, not completed evidence.
