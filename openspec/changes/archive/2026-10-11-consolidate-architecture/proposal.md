## Why

A 2026-10-06 architecture review rated the app as correct and secure but expensive to change for a
one- or two-person team. The causes are accidental complexity, not wrong behaviour:

- Idempotency runs through four overlapping layers (in-process `ReplayCache`, Postgres claim slot,
  in-transaction claim, Upstash slot), mixed differently per route. `POST /expenses` is a 310-line
  handler.
- Two Postgres pools per instance (`core/db/index.ts`, `core/db/transaction.ts`), the second on the
  direct connection with `max: 5`, so a warm serverless instance can hold up to 10 connections.
- An HMAC "verified" member tier that duplicates the server-verified Supabase identity, plus
  redundant admin guards and response-JSON sniffing in `requireWgMember`.
- Three ways to build error responses, hand-written Zod error ladders, nested catch-alls.
- `core/` imports `features/`; the boundary script does not see it. E2E fixture branches live in
  production guards.
- Every client screen rebuilds cache + optimistic + offline + polling state by hand; the dashboard
  page (~500-line function), `ImportWizard` (827 lines) and several 500+-line hooks. Chore
  completion exists twice and the copies drifted (idempotency key, offline behaviour, copy).
- 64 unit-test files load code through a hand-rolled `vm`/`transpileModule` module system; some
  cut functions out of source text or regex-match generated SQL; pure unit tests live in `e2e/`.
- Components live in four folders, features mix server and client modules, comments mix German
  and English and narrate history, Zustand is used for one toast store.

## What Changes

- **Data access**: one pool factory and one module for `db` and `withTransaction`, with a
  documented per-instance connection budget.
- **Identity**: remove the HMAC member token and the `verified` flag; the Supabase session plus the
  active `wg_members` row is the only identity proof. One admin guard family
  (`requireAdmin`, `requireOwnerOrAdmin`). `requireMember` returns a typed failure reason.
- **Idempotency**: one primitive, `withIdempotentWrite`, built on the transactional Postgres claim.
  The in-process `ReplayCache` and the Upstash slot are removed.
- **HTTP**: one error-helper set, one `parseBody(schema)` helper, no nested catch-alls.
- **Layering**: cross-feature reads move to `src/composition/`; the boundary check forbids
  `core -> features|composition|app` and `features -> composition|app`.
- **Fixture mode**: E2E db-down handling is isolated in one module behind a single seam.
- **Client state**: one shared synced-collection hook used by shopping, chores, inventory and
  pinnwand; one online/visibility subscription; chore completion implemented once; large
  components split.
- **Tests**: unit tests import real modules through one loader with explicit module mocks; no
  source-text extraction; pure tests leave `e2e/`; SQL assertions become behaviour assertions.
- **Structure**: one component tree, features split into `server/` and client modules with
  `server-only`, English-only comments without history narration, Zustand removed.
- **Guardrails**: CI checks for file and function size budgets, layering, test conventions and
  banned patterns, and the conventions written down in `AGENTS.md` and `docs/architecture.md`.

## Capabilities

### New Capabilities

- `codebase-conventions`: Structural rules the repository enforces in CI so the codebase stays
  maintainable.

### Modified Capabilities

None. User-visible behaviour, response shapes and status codes stay the same except that
`403 member_not_verified` is no longer returned (every authenticated active member is the
verified caller).

## Impact

- Most of `apps/web/src/app/api/**`, `core/guards`, `core/db`, `core/http`, the feature hooks and
  the unit-test suite.
- No schema change, no migration, no deployment. `MEMBER_SESSION_SECRET` becomes unused.

## Non-goals

No new features, no visual redesign, no change to the database schema, the offline queue format
or the client idempotency-key strategy. No Production or Preview changes.
