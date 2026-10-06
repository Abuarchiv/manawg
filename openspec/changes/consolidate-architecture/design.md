## Context

See `proposal.md`. Constraints: Next.js 15 on Vercel (serverless, fra1), Supabase Postgres through
Supavisor, node:test unit tests, Playwright fixture-mode e2e without a database.

## Decisions

### 1. One pool

`core/db/index.ts` owns a single lazily built `pg.Pool` and exposes `db` and `withTransaction`.
The pool uses the pooled URL (`POSTGRES_URL`/`DATABASE_URL`). Drizzle binds `BEGIN`/`COMMIT` to one
client, which Supavisor transaction mode supports; advisory transaction locks
(`pg_advisory_xact_lock`) are transaction-scoped and therefore also safe there. `max` stays 5 per
instance: one pool instead of two halves the worst case. `withFreshTransaction` (uncertain-commit
resolution) keeps its dedicated short-lived client.

### 2. Identity without the member token

The member token was `HMAC(secret, wgId:memberId)`, handed only to an already authenticated member
and never expiring, so it proved nothing the Supabase session does not. CSRF is covered by the
middleware's same-origin check. Removing it deletes `member-token.ts`, `requireVerifiedMember`,
`isVerifiedWgAdmin`, `checkWgAdminAccess` and the `member_not_verified` client branches.
`x-manawg-expected-member-id` (409 `member_context_changed`) stays: it protects against a stale tab
acting as a different member.

`requireMember` returns `{ ok: false, reason, response }` with
`reason: 'auth_required' | 'not_a_member' | 'member_deactivated' | 'member_context_changed' | 'db_error'`.

### 3. `withIdempotentWrite`

```ts
withIdempotentWrite<T>({ scope, key, isCompleted }, async (tx) => ({ status, body }))
```

Claims the slot (`claimResponseSlot`), opens one transaction, locks the claim, replays a completed
body, otherwise runs the write and completes the claim in the same transaction; on a confirmed
rollback it releases the claim with its lease. Without a key it runs the body in a plain
transaction. `withIdempotentJsonResponse` becomes a thin wrapper or is removed. The in-process
`ReplayCache` is removed (the Postgres claim already serializes concurrent requests across
instances). The Upstash `claimIdempotencySlot` for audit side effects is replaced by the same
Postgres claim.

### 4. Composition layer

`src/composition/` holds read models that combine features (dashboard data and insights, activity,
export queries, activity feed). Allowed imports: `composition -> features, core, shared`.
`app -> anything`. `features -> core, shared, own feature`. `core -> core, shared`.

### 5. Fixture seam

Fixture data and mode detection live in the top-level `src/fixtures/` layer, which only `app`
(including `src/middleware.ts`) may import. One seam per entry: the middleware answers fixture API
requests before any route runs (`resolveFixtureRequest`), the WG layout and chat page load fixture
page data (`loadFixtureWgView`), and client pages receive their options from
`fixtureClientProps`. The fixture API reads the caller from `x-manawg-expected-member-id`, so the
API client needs no fixture switch. Core guards carry no fixture branches; core and component
modules take plain options (`requireWgSignIn`, `sessionless`).
The rest of the code does not know fixture mode exists.

### 6. Synced collections

`useSyncedCollection` owns cached fetch, optimistic overlay, offline enqueue, polling paused by
visibility and online refresh. Feature hooks only describe their resource (URL, id, merge rules,
offline action builders) and their domain actions.

### 7. Unit-test loader

A Node module-customization hook (`tests/support/loader.mjs`) resolves `@/` aliases and
extensionless TypeScript imports and strips types via Node's built-in type stripping (JSX through
the TypeScript transpiler for `.tsx`). Mocks use `node:test` `mock.module`. Tests import modules
the same way the app does; no `vm`, no source-text extraction.

### 8. Guardrails

`scripts/check-architecture.mjs` (run by `lint` and CI) enforces: layering, file size budget
(400 lines for source, 800 for tests, with an explicit allowlist that may only shrink), no `vm` or
`transpileModule` in tests, no `isE2EDbDownMode` outside the fixture seam, `server-only` in
`features/*/server/`, no numeric status literals passed to `apiError`, no German comments.

## Risks

- Money routes: each idempotency migration keeps its replay tests and the expense integrity route
  tests green.
- Test migration: test counts are compared before and after; no behaviour test is dropped without
  an equivalent.
- Removing the member token changes which requests can mutate: none that a member with a session
  could not already perform through the UI.
