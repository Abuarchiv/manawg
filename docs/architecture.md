# Architecture

Overview of `apps/web` for contributors. Paths are relative to `apps/web/src` unless stated
otherwise. Setup, commands and deployment are in the [README](../README.md).

## Request flow

```
browser
  -> middleware.ts                    CSP nonce, Origin check, rate limit, Supabase session refresh
  -> app/api/wg/[code]/**/route.ts    thin handler
       withWgRoute / readShareCode    normalize + validate share code, optional E2E fixture, catch -> server_error
       (body validation)              before auth, so invalid_body cannot leak membership
       requireWgMember                Supabase user -> WG by share code -> active wg_members row
       withIdempotentJsonResponse     optional, for mutations carrying Idempotency-Key
       features/<x> / core/reads      domain logic
       core/db (Drizzle, pg Pool)     Postgres
```

**Middleware** (`middleware.ts`):

- Pages (non-`/api`): fresh CSP nonce per request (`core/infra/security-headers.ts`), COOP
  header, Supabase session refresh. `/wg/*` without a session redirects to `/neu?next=...`
  (`core/auth/middleware.ts`).
- API paths in the matcher (`/api/account`, `/api/auth/*`, `/api/wg[/*]`, `/api/calendar/*`,
  `/api/upload/*`, `/api/cron/*`):
  1. `MIGRATION_READ_ONLY=true`: writes and crons get `503 migration_read_only`.
  2. Mutating requests need an `Origin` matching host and protocol, else `403 cross_origin_blocked`.
  3. Upstash sliding-window limit per client IP: share-code lookup, read or write bucket
     (`core/rate-limit.ts`). Fail mode is `closed` when `VERCEL_ENV=production`,
     `NODE_ENV=test`, or `NODE_ENV=production` without `VERCEL_ENV`; otherwise `open`. Closed
     plus missing/failing Upstash means `503 rate_limiter_unavailable`.
  4. Supabase session refresh.
- `/api/health` and `/api/paypal/*` are outside the matcher; `/api/health` applies its own limiter.

**Route handlers** use `withWgRoute` (`core/guards/with-wg-route.ts`) for the share-code
preamble and the catch-all `logApiError` + `server_error`. It deliberately does not authenticate;
handlers call `requireWgMember` (`core/guards/require-wg-member.ts`) after body validation.
Unknown or foreign share codes count against `wgShareCodeMissLimiter` (20/hour/account).
WG-settings writes use `requireWgAdmin` (`core/guards/require-wg-admin.ts`).

**Pages under `app/wg/[code]/`** are authenticated only by `app/wg/[code]/layout.tsx`
(`getAuthenticatedUserFromCookies()`). The middleware is not an independent barrier there: on a
transient Supabase Auth failure it serves the page instead of redirecting.
`scripts/check-wg-auth-invariant.mjs` therefore fails on any `route.ts` or `'use server'` file
under `app/wg/**`; WG APIs belong under `app/api/wg/**`.

## Layering

| Layer | Contains | May import |
| --- | --- | --- |
| `app/` | Pages, layouts, route handlers. Thin. | everything below |
| `features/<x>/` | Vertical slices: `chat`, `chores`, `events`, `expenses`, `inventory`, `pinnwand`, `shopping` (logic, hooks, components) | `core/`, `shared/`, own files |
| `core/reads/` | Cross-feature reads/composition: dashboard data and insights, activity feed, export | `core/`, several `features/*` (chores, expenses, events, pinnwand) |
| `core/` (rest) | Domain-neutral blocks: `db`, `auth`, `guards`, `http`, `offline`, `notifications`, `infra`, `utils`, `validators` | `core/`, `shared/` (exception: `core/activity-feed.ts` imports chat constants) |
| `components/` | Shared UI (`ui/` shadcn, `animate-ui/`, `app/` shell, `wg/`) | |
| `shared/` | Presentation utilities (theme, fonts, analytics, identity, header names) | |

Rules:

- A feature never imports another feature. `scripts/check-feature-boundaries.mjs` resolves
  aliased and relative specifiers and fails CI on a cross-feature import.
- Cross-feature side effects go through `core/` (e.g. `core/activity-feed.ts` posts system
  notices to the pinnwand feed; `core/audit.ts` records audit events).
- Cross-feature reads go through `core/reads/`, which the boundary script does not check
  (it only scans `features/`).

## Identity model

- **Auth user**: Supabase Auth (social, email/password). Callback `app/auth/callback/route.ts`,
  password reset `app/auth/reset`.
- **Member**: one `wg_members` row per WG and auth user (`auth_user_id`, unique per WG). A user
  can be a member of several WGs. `deactivated_at` is the move-out soft delete; deactivated
  members lose API access and push, history stays.
- **Membership check** (`core/guards/api-auth.ts` `requireMember`): the server-verified
  Supabase user is looked up in `wg_members`. That lookup is the authoritative identity proof.
  `x-manawg-expected-member-id` mismatch yields `409 member_context_changed`.
- **Member token** (`core/guards/member-token.ts`):
  `HMAC-SHA256(MEMBER_SESSION_SECRET, "<wgId>:<memberId>")`, issued by `GET /api/wg/<code>`
  and sent back as `x-manawg-member-token`. A valid token sets `verified: true`. Money/state
  mutations that trust a caller-claimed id call `requireVerifiedMember`
  (`core/http/api-errors.ts`) and answer `403 member_not_verified` without it. No session table:
  the token is recomputed on every request.
- **Admin**: `wg_members.role` is `admin` or `member`, at most one admin per WG (partial unique
  index). `core/guards/admin.ts`: `isWgAdmin`, `isVerifiedWgAdmin`, `requireOwnerOrAdmin`
  (owner or verified admin for edits/deletes of others' items) and `checkWgAdminAccess` (WG
  rename/delete/share-code rotation/joining toggle; requires a verified admin).

## Idempotency

Mutations that may be retried (offline replay, flaky mobile networks) send a UUID
`Idempotency-Key` header (`core/idempotency-store.ts` `readIdempotencyKey`; non-UUIDs are
ignored).

1. **In-process**: `ReplayCache` (`core/guards/idempotency.ts`) deduplicates concurrent
   requests on the same warm instance.
2. **Cross-process**: table `idempotency_responses` (primary key `scope, key`).
   `claimResponseSlot` inserts a `{"_claimed": true}` placeholder; the loser polls
   (`claimReplaySlotWithRetry`) until the winner's response is stored, then replays it.
   Claim/cache errors fail closed.
3. **Completion**: `setCachedResponse`, or the claim helpers in `core/db/claimed-response.ts`
   inside the mutation's transaction, so the response row commits atomically with the write:
   `lockClaimedResponse` (row lock; returns the stored response or the placeholder's lease),
   `completeClaimedResponse` (replaces only the placeholder with that lease) and
   `releaseLockedClaim` (in-transaction release, e.g. after a rate limit).
4. Only successful statuses are cached; failures release the claim so a retry runs again.
   Responses over 32 KiB are stored as replay-unavailable. Rows live 7 days
   (`RESPONSE_REPLAY_TTL_SECONDS`) and are purged by the maintenance cron.

`withIdempotentJsonResponse` wraps this for JSON routes. `claimIdempotencySlot` (Upstash, 5 min,
fail-open) is a separate best-effort dedup for audit side effects only.

After a rollback, routes call `releaseClaimedResponse`, which only deletes the placeholder with
the lease that request locked: a request whose lease ran out can neither complete nor delete the
claim of the request that took the key over. The protocol is specified in
[`openspec/changes/unify-idempotency-claims`](../openspec/changes/unify-idempotency-claims/proposal.md).
Remaining unleased releases: the CSV import route, inventory consume and
`withIdempotentJsonResponse` (`releaseResponseSlot`).

## Money

- All amounts are integer cents. `features/expenses/split-math.ts`: equal splits use
  largest-remainder rounding, so `sum(splits) === amount` and shares differ by at most 1 cent.
  `validateSplits` rejects duplicates, negative/non-finite cents and sums that differ from the
  total. The payer's own split is stored as already settled (`settledAtForOwnShare`).
- Balances: `features/expenses/debts.ts` aggregates unsettled splits per debtor/creditor pair;
  `debt-reduction.ts` computes net balances (including completed PayPal payments) and
  `simplifyDebts` for settlement suggestions.
- Paid-by rule (`features/expenses/paid-by-guard.ts`): whoever records an expense paid by
  someone else must bear a positive share. It applies to manual entry, Abos and CSV/OCR imports;
  only a verified WG admin may import a shared history with rows they are not part of.
- Manual settlement sets `expense_splits.settled_at`
  (`/api/wg/<code>/expenses/[id]/splits/[splitId]/settle`, `/expenses/settle-batch`).
- PayPal (`/api/wg/<code>/paypal/{connect,order,capture}`, `features/expenses/paypal-*.ts`): the
  payee connects via PayPal partner referrals (`paypal_merchant_id`). An order is created for the
  simplified net debt; `expense_payments.status` goes `created -> capturing -> completed|failed`,
  with one active payment per member pair. Only a server-confirmed capture counts. Payment work
  takes a per-WG advisory lock (`lockExpensePayments`). The maintenance cron reconciles
  `capturing` rows older than 15 minutes, because they block the WG's finances. All of PayPal is
  off when `PAYPAL_*` is empty. Operator setup: [paypal-setup.md](paypal-setup.md).
- Recurring expenses ("Abos") are templates in `recurring_expenses`, materialized by the
  `recurring-advance` cron. `anchor_at` keeps the day-of-month (31.01 → 28.02 → 31.03); edits are
  a compare-and-set on `next_due_at` so a concurrent booking is never written back
  (`409 recurring_expense_changed`).

## Offline queue

`core/offline/`:

- Supported actions (`OfflineActionType`): shopping create/update, announcement create, absence
  create, chore create/complete, expense create/update, recurring create/advance. Per-type request
  building lives in one handler table in `offline-queue.ts`.
- The queue is JSON in `localStorage` (`manawg:offline-actions`, `offline-client.ts`), guarded by
  a queue lock. Each action stores a stable `idempotencyKey`; replay sends it as
  `Idempotency-Key`, so a request that reached the server before the connection dropped is
  replayed rather than duplicated. Retries back off exponentially (max 15 min).
- Review window: the server keeps replay rows for 7 days, so actions older than
  `OFFLINE_REPLAY_MAX_AGE_MS` (7 days minus clock skew and two request timeouts,
  `replay-retention.ts`) are not resent automatically and need manual review in settings.
  Edited actions, missing local images and some server errors also require review.

## Notifications

- Web Push via `web-push` with VAPID keys; service worker `public/sw.js`. Subscriptions live in
  `push_subscriptions`; 404/410 responses delete the subscription.
- `core/notifications/notification-dispatch.ts` `dispatchNotification` resolves active members,
  applies per-category preferences (`notify_*` columns), quiet hours (Berlin time, skipped for
  `urgent`) and `push_opt_in`, and sends in batches of 10. `dispatchNotificationSafely` adds a
  5 s timeout so a push failure never fails the triggering request.
- A browser endpoint is stored once per member (`(member_id, endpoint)` unique), so one device
  receives pushes for every WG of the same account. Unsubscribing in one WG keeps the browser
  subscription while another WG still uses it (`endpointInUse`); an endpoint still owned by an
  active member of another account is refused (`endpoint_owned`).
- Payloads carry a relative `/wg/<code>/…` link, a TTL (12 h urgent, 24 h otherwise) and a
  10 s request timeout, so stale reminders are not delivered days later.
- Without VAPID variables push is disabled; in production `VAPID_SUBJECT` is required.

## Privacy and observability

- **Sentry** (`core/infra/sentry.ts`, only with `NEXT_PUBLIC_SENTRY_DSN`):
  `sanitizeSentryEvent` (`core/infra/sentry-privacy.ts`) drops user, message, extra and most
  contexts, replaces exception values with `[redacted]`, normalizes error names, strips query
  strings, redacts share codes in `/wg/<code>`, calendar tokens and storage/S3 object paths, and
  only keeps allowlisted tags. Console and UI breadcrumbs are dropped.
- **Server logs**: `logApiError` (`core/infra/observability.ts`) logs the static label and the
  error name only, never message or stack.
- **PostHog** (`instrumentation-client.ts`): initialized only when `NEXT_PUBLIC_POSTHOG_HOST` is
  `https://eu.i.posthog.com`; cookieless, memory persistence, no person profiles, no autocapture
  or session recording. `before_send` allows only `$pageview`, `wg_created`, `wg_joined` and
  rebuilds the event without URL or caller properties. `scripts/check-analytics-privacy.mjs`
  enforces this in CI.
- **Boot report**: `instrumentation.ts` runs `checkEnv` and logs `[env] MISSING REQUIRED` /
  `[env] DEGRADED`; it reports to Sentry but does not crash the server. `/api/health` returns only
  counts and feature names.

## Database

- Schema: `core/db/schema.ts` (Drizzle). Migrations: `apps/web/drizzle/` with
  `meta/_journal.json`; `0000_baseline.sql` replaced an earlier non-replayable chain.
  `scripts/db-migrate.mjs` applies them under an advisory lock, checks the ledger against the
  journal (fail-closed, with an explicit legacy-hash allowlist) and verifies the result
  (`--check`).
- Security: RLS is enabled on the application tables (`0010_enable_public_rls.sql`; later tables
  in `0015`, `0017`) without policies, as defense in depth. Privileges for `anon`,
  `authenticated` and `PUBLIC` are revoked (`0007`, `0016`). The app reads and writes tables
  through its own server connection, not the Supabase Data API. Triggers
  (`0013_member_wg_invariants.sql`) enforce that member references belong to the same WG.
- Runtime connections (`core/db/index.ts`, `transaction.ts`, `connection.ts`): `pg.Pool` with
  `max: 5`, `statement_timeout` 5 s, `lock_timeout` 2 s, `query_timeout` 5.5 s, connect timeout
  2 s. Queries use `POSTGRES_URL || DATABASE_URL`; transactions use
  `POSTGRES_URL_NON_POOLING || DATABASE_URL_UNPOOLED || POSTGRES_URL`. Remote URLs must carry a
  port; TLS is forced to `verify-full` with the pinned Supabase root CA (`supabase-ca.ts`). URLs
  may not override timeouts or host via query parameters. Differing alias pairs log a warning.

## Image storage

`IMAGE_STORAGE_PROVIDER` selects the provider (`core/infra/supabase-storage.ts`):

- `supabase` (private): uploads are signed via `/api/upload/sign`; reads go through
  `/api/upload/read?key=...`, which re-checks membership of the WG encoded in the key and the
  deletion tombstones, and streams with `no-store`. The bucket (`SUPABASE_STORAGE_BUCKET`) must be
  private with an 8 MiB limit and exactly the MIME types in `core/infra/private-image-policy.ts`;
  otherwise the provider reports itself unconfigured. Deletions are tombstoned in
  `private_image_deletions` and removed by the maintenance cron.
- `aws` (default when unset, legacy): presigned S3 PUT (`core/infra/s3.ts`); images are stored
  as public URLs under `S3_PUBLIC_URL`. There is no S3 delete path.

## Cron jobs

Four Vercel crons, see the table in the [README](../README.md#cron-jobs). All open with
`requireCronSecret` (constant-time bearer compare, `core/infra/cron-auth.ts`) and fail closed
without `CRON_SECRET`, cap
work per run (batches, limits) and leave the rest to the next run. Reminder crons deduplicate
with claim rows/throttle timestamps so a re-run does not notify twice.

## Key decisions

- **Response replay in Postgres, not Redis.** Production once had empty `UPSTASH_*` values; the
  Redis client silently no-opped and duplicate expenses were inserted
  (`core/idempotency-store.ts`, `core/guards/idempotency.ts`).
- **Stateless HMAC member token.** Deterministic per (WG, member): no session table, no backfill;
  a bare `x-manawg-member-id` is readable from the members list and must not prove identity
  (`core/guards/member-token.ts`).
- **Rate limiter fails closed in production.** A missing or failing Upstash answers 503 instead
  of leaving share-code lookups (brute-force defense) and writes unthrottled; `checkEnv` therefore
  treats `UPSTASH_*` as required in production (`core/rate-limit.ts`, `core/infra/env.ts`).
- **Missing env does not crash boot.** A crash would take down every tenant; instead
  `instrumentation.ts` reports to Sentry and logs, and features degrade.
- **Validation before auth in WG routes.** `withWgRoute` does not call `requireWgMember`, so
  `invalid_share_code`/`invalid_body` precedence is stable and cannot reveal membership.
- **Integer cents with largest-remainder rounding.** Summing rounded floats does not reproduce
  the total; splits must sum exactly (`features/expenses/split-math.ts`).
- **Cross-feature effects via `core/`.** Posting a pinnwand notice is infrastructure, not
  pinnwand logic, so features do not import each other (`core/activity-feed.ts`).
- **Offline handlers in one core table.** Splitting them per feature would need a registration
  bootstrap; a `Record<OfflineActionType, ...>` lets `tsc` enforce a handler per type
  (`core/offline/offline-queue.ts`).
- **Redacted logging.** Raw errors copied stacks and provider payloads (Postgres, PayPal) into
  long-lived logs, so only label and error name are logged (`core/infra/observability.ts`).
- **Shared input limits.** Forms and API validation read name limits from
  `shared/lib/limits.ts`, so browser and server reject the same values; a test keeps it equal to
  the database's `LIMITS.NAME_MAX`.
- **Deleted means deleted.** A deleted chat message loses its text at rest, the audit log keeps
  no preview, and exports never contain deleted text or images.
- **Oversized bodies are 413, not 400.** `readJsonLimited` routes map its error through
  `unreadableJsonBody`, so the client can tell "shorten this" from "malformed".
- **Browser floor Safari 16.4.** `api-client.ts` falls back from `AbortSignal.any` (Safari 17.4+)
  to its own controller; raw `fetch` calls carry the same 15 s timeout as `apiFetch`.
- **Counts, not rows, for summaries.** `GET /export?summary=counts` counts with the dump's filters,
  so the settings page does not download a WG's whole chat to show numbers.
- **Bounded service-worker cache.** Chunks fetched while browsing live in a capped runtime cache;
  `sw.js` does not change between deploys, so nothing else would evict them.
- **Migrations give up instead of queueing.** `db-migrate.mjs` sets `lock_timeout = 5s`, so DDL
  that cannot get its lock rolls back rather than stalling every query on the table.
- **Baseline migration with adoption.** The push-era migration chain could not replay on an empty
  database; existing databases record the baseline as applied instead of executing it
  (`scripts/db-migrate.mjs`).
- **Calendar feed keeps 90 days of history.** Subscribed calendar apps mirror the feed and delete
  what leaves it; starting at today removed yesterday's events from everyone's phone.
- **Event years 1900–2200.** Wide enough for yearly birthdays; a typo like year 0026 or 20266 is
  rejected in the form and the API instead of being stored and expanded.

## Glossary

Route folders under `app/wg/[code]/`, with the code names behind them.

| UI / route (German) | Code | API (`/api/wg/<code>/...`) | Tables |
| --- | --- | --- | --- |
| WG (`/wg/[code]`, share code) | `wgs` | `/api/wg/<code>` | `wgs` |
| Mitglied, Auszug | members, `deactivatedAt` | `members` | `wg_members` |
| Ausgaben (`ausgaben`) | `features/expenses` | `expenses` | `expenses`, `expense_splits`, `expense_payments` |
| Abos (`abos`) | recurring expenses (`features/expenses/recurring-expenses.ts`) | `recurring-expenses` | `recurring_expenses` |
| Import (`import`) | expense import (`features/expenses/import-*.ts`) | `imports` | `expense_imports` |
| Mahnungen / Erinnerungen (`mahnungen`) | payment reminders (`features/expenses/reminders.ts`) | `reminders` | `expense_reminders` |
| Putzen / Putzplan (`putzen`) | `features/chores` | `chores` | `chores`, `chore_completions` |
| Abwesenheiten (panel on `putzen`) | absences (`features/chores/absence.ts`) | `absences` | `member_absences` |
| Pinnwand (`pinnwand`) | announcements (`features/pinnwand`) | `announcements` | `announcements`, `announcement_comments`, `announcement_reactions` |
| Einkauf (`einkauf`) | `features/shopping` | `shopping` | `shopping_items` |
| Vorräte / Inventar (`vorraete`) | `features/inventory` | `inventory` | `wg_inventory_items`, `wg_inventory_log` |
| Kalender (`kalender`) | events (`features/events`) | `events`, `calendar-subscription` | `wg_events`, `calendar_subscriptions` |
| Chat (`chat`) | `features/chat` | `chat` | `wg_chat_messages`, `wg_chat_reactions`, `wg_chat_reads`, `wg_chat_mentions` |
| Aktivität (`aktivitaet`) | activity (`core/reads/activity.ts`) | `activity` | `audit_events` |
| Einstellungen (`einstellungen`) | settings | `notifications`, `export`, ... | |

"Erinnerungen" for chores and events are push notifications sent by the `chore-reminders` and
`event-reminders` crons, not the `reminders` API.
