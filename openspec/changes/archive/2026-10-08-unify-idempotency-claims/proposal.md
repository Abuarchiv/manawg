## Why

Every WG mutation that accepts an `Idempotency-Key` claims a row in `idempotency_responses`, then locks, validates and completes it inside its write transaction. That protocol is hand-rolled in about eleven routes and features with drifting details (2026-10-05 release audit):

- body match by jsonb `=` in some places and `@>` in others; expiry checked in some lock steps and not others;
- three completion styles (`= placeholder AND expires_at > now()`, `@> placeholder` without expiry, an unconditional upsert for shopping create);
- releases with and without a lease check, and routes that never release after a rollback (fixed for WG create, calendar subscription and recurring create in this release; expenses still releases only for listed codes).

None of these is a duplicate-write bug today: the row lock plus "body is still the placeholder" serializes competing requests, and the remaining gap (shopping create, `withIdempotentJsonResponse` routes) needs a request stalled longer than the 15-minute lease. But each new route copies one of the variants, and a wrong copy in a money path is exactly the bug this protocol exists to prevent.

## What Changes

- One transaction-scoped helper set in `core/db/claimed-response.ts`: `lockClaimedResponse`, `completeClaimedResponse` and `releaseClaimedResponse`, with a single placeholder predicate (`response_body = '{"_claimed":true}'::jsonb`) and lease-checked completion and release.
- All lock/complete/release sites use the helpers. Shopping create switches from an unconditional upsert to lock + complete.
- Every route releases its claim after a confirmed rollback, so a same-key retry runs immediately.

## Capabilities

### New Capabilities

- `idempotent-mutations`: Claim, replay and release semantics shared by all WG mutations that accept an `Idempotency-Key`.

### Modified Capabilities

None.

## Impact

- About 11 production files (chores, chore completion, absences, expenses, events, calendar subscription, recurring expenses, WG create, chat messages, pinnwand replay, import commit, inventory and shopping mutations).
- About 13 unit-test harnesses that hand-build drizzle chains for this table; their stubs get simpler.
- No schema change, no migration, no client change. Response shapes and status codes stay as they are.

## Non-goals

No change to the in-process `ReplayCache`, the claim TTL, the 7-day replay retention, the client key strategy, or the offline queue.
