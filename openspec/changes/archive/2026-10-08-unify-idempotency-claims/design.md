## Context

`claimResponseSlot` (`core/idempotency-store.ts`) upserts a placeholder `{"_claimed":true}` with a 15-minute `expires_at`; it overwrites a row only when `expires_at <= now()`. `response_body` is jsonb. Routes then run their write in a transaction that locks the slot `FOR UPDATE`, checks it is still the placeholder, writes, and replaces the body with the final response and a 7-day expiry.

Verified on 2026-10-05: no completed body has a top-level `_claimed` key, so `=` and `@>` match the same rows; jsonb equality ignores whitespace. Missing expiry checks are safe because a reclaim writes a fresh placeholder that the row lock serializes against.

## Decisions

### 1. One predicate: jsonb equality with the placeholder

`response_body = '{"_claimed":true}'::jsonb` matches the strict JS check (`exactly one key, _claimed === true`) used by every lock step. `@>` is dropped: it would also accept a placeholder with extra keys, which never exists, and the difference only makes reviews harder.

### 2. The lock returns the lease

```ts
type LockedClaim<T> =
  | { kind: 'claimed'; leaseExpiresAt: Date }
  | { kind: 'completed'; body: T };

lockClaimedResponse<T>(tx, scope, key, isCompleted: (body: unknown) => body is T): Promise<LockedClaim<T>>;
completeClaimedResponse(tx, scope, key, body: object, lease: Date): Promise<void>;
releaseClaimedResponse(scope, key, lease: Date): Promise<void>;
```

- A missing row throws `TransactionAbort('idempotency_claim_missing')`; an expired or foreign body throws `TransactionAbort('idempotency_claim_invalid')`. `TransactionAbort` keeps the code as its message, so callers comparing `err.message` keep working.
- Completion matches the placeholder and the lease it locked, and throws when no row matched, so a rollback can never publish another request's slot.
- Release (already added for three routes) deletes only the placeholder with that lease.

### 3. Migrate route by route behind the existing tests

Each route keeps its own response type guard (`isCompleted`) and replay behavior. The existing replay tests per route stay the acceptance criteria; harnesses get an override for `@/core/db/claimed-response` instead of hand-built `select…for()` chains.

## Risks

- Money paths (expenses, recurring, import, PayPal-locked writes): migrate them last, one commit each, with the expense-integrity and import-export e2e specs green on every step.
- Shopping create changes from upsert to lock + complete: cover the bought-item duplicate case that the unique open-name index does not catch.
