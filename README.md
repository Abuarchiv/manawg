# ManaWG

Shared-household app (expenses, chores, shopping, inventory, calendar, chat, pinboard) at
https://app.manawg.com. Next.js 15 App Router, React 19, Supabase Auth, Postgres via Drizzle,
Tailwind 4 with shadcn/base-ui, Playwright.

Further reading: [architecture](docs/architecture.md), [release checklist](docs/release-checklist.md),
[external release prerequisites](docs/releases/external-prerequisites.md),
[database recovery](docs/database-recovery.md), [support runbook](docs/support-runbook.md),
[PayPal setup](docs/paypal-setup.md). Agent rules are in `AGENTS.md`.

## Layout

```
apps/web/
  src/app/        routes only: pages, layouts, API handlers (thin, call core/features)
  src/core/       domain-neutral building blocks: db, auth, guards, http, offline, notifications, infra
                  core/reads/ is the cross-feature read/composition layer (dashboard, activity, export)
  src/features/   vertical slices (chat, chores, events, expenses, inventory, pinnwand, shopping)
                  a feature may import core/, shared/ and itself, never another feature
  src/components/ reusable UI: ui/ (shadcn), animate-ui/ (motion variants), app/ (shell, PWA, theme), wg/ (WG-wide)
  src/shared/     framework-light utilities (lib/, fonts, css): theme, brand, analytics, identity
  drizzle/        SQL migrations (`pnpm --filter @manawg/web db:generate` / `db:migrate`)
  e2e/            Playwright specs (fixture mode needs no database)
  tests/          node:test suites that are not colocated with a module
  scripts/        CI gates and the migrator
docs/             brand contract, runbooks, release evidence, research/
openspec/         change proposals and specs
```

## Prerequisites

- Node 22 (`.nvmrc`, `engines.node: 22.x`).
- pnpm 9.0.0 (`packageManager: pnpm@9.0.0`; `corepack enable` picks it up).
- For a working local app: a Supabase project (Auth + Postgres) you are allowed to use for
  development. Never point local work at Production.

## Local setup

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local   # or: vercel env pull apps/web/.env.local
pnpm dev                                       # http://localhost:3000
```

Minimum variables in `apps/web/.env.local` (`checkEnv` in `src/core/infra/env.ts`, logged once at boot):

| Variable | Why |
| --- | --- |
| `POSTGRES_URL` (or `DATABASE_URL`) | Runtime database. Remote URLs need an explicit port; TLS is enforced (`src/core/db/connection.ts`). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth. Without them every `/wg/*` page redirects to `/neu`. |
| `MEMBER_SESSION_SECRET` | Signs calendar feed URLs and verifies legacy-profile recovery proofs (`openssl rand -hex 32`). Not used for normal API access. |

Optional features degrade when unset and are reported as `[env] DEGRADED ...`: Upstash rate
limiting (`UPSTASH_REDIS_REST_*`, fails open outside production), Web Push (`VAPID_*`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), account deletion (`SUPABASE_SERVICE_ROLE_KEY`), image uploads
(`IMAGE_STORAGE_PROVIDER` plus its provider variables). PayPal stays off while all `PAYPAL_*`
values are empty. Every variable is described in `apps/web/.env.example`. Never commit or print
env values.

### Database migrations

```sh
DATABASE_MIGRATION_URL=... pnpm --filter @manawg/web db:migrate   # apply pending migrations
DATABASE_MIGRATION_URL=... pnpm --filter @manawg/web db:check     # verify schema + ledger only
```

`scripts/db-migrate.mjs` does not read `.env` files; export the variable in the shell. It
resolves `DATABASE_MIGRATION_URL` first (then `POSTGRES_URL`/`DATABASE_URL`, then the
non-pooling pair) and only accepts a direct Supabase connection: host `*.supabase.co`, port
`5432`, `sslmode` as the only query parameter. The transaction pooler port `6543` is rejected.
Production is migrated only by the GitHub workflow (see [Deployment](#deployment)).

New migrations: edit `src/core/db/schema.ts`, then `pnpm --filter @manawg/web db:generate`
(drizzle-kit; `drizzle.config.ts` loads `.env` via `dotenv/config`).

### Fixture mode (no database)

The app can run against in-memory fixtures from `src/fixtures/` (two fixture WGs, share codes
`MTE8PZAT` and `SMKETEST`). `isE2EDbDownMode()` (`src/fixtures/mode.ts`) only switches on when all
of these hold: `E2E_FIXTURE_MODE=true` (or `NODE_ENV=test`), `NEXT_PUBLIC_DB_DOWN=true`,
`CI=true`, `VERCEL` not `1`, `VERCEL_ENV` not `production`, and neither `POSTGRES_URL` nor
`DATABASE_URL` set. It trusts the plain `x-manawg-expected-member-id` header without real
authentication, so it can never activate on a Vercel deployment. `test:e2e:fixtures` sets all of
this and builds an isolated server on port `3101` (`E2E_PORT`).

Only `src/app/` (including `src/middleware.ts`) imports `src/fixtures/`, through one seam per
entry: `resolveFixtureRequest` in the middleware answers fixture API reads and `POST /api/wg`
before any route runs, `loadFixtureWgView` feeds the WG layout and chat page,
and `fixtureClientProps` hands `sessionless` to the `/neu` and `/offline` clients. The API client
needs no fixture switch: it always sends `x-manawg-expected-member-id`, which the fixture API
reads as the caller. Core, components and features receive plain options (`requireWgSignIn`,
`sessionless`) and never see fixture mode.

## Commands

```
pnpm install
pnpm dev                          # http://localhost:3000
pnpm lint                         # biome (whole repo)
pnpm --filter @manawg/web lint   # biome + feature-boundary + wg-auth-invariant checks
pnpm typecheck
pnpm --filter @manawg/web test:unit
pnpm build
pnpm --filter @manawg/web test:e2e:fixtures   # full Playwright suite against a fixture build
```

More scripts in `apps/web/package.json`:

| Command | What it runs |
| --- | --- |
| `pnpm test` (root) | `playwright test` in `apps/web` (dev server with your `.env.local`), **not** the unit tests |
| `pnpm --filter @manawg/web test:unit` | `node --test` over `src/**/*.test.mjs` and `tests/*` |
| `pnpm --filter @manawg/web test:e2e:fixtures` | Playwright against a production build in fixture mode |
| `pnpm --filter @manawg/web test:e2e:webkit` | WebKit fixture config (`playwright.webkit-fixtures.config.ts`) |
| `pnpm --filter @manawg/web test:e2e:account-delete-db` | Account deletion against a disposable loopback Postgres in `ACCOUNT_DELETE_TEST_URL` |
| `pnpm --filter @manawg/web bundle:check` | Bundle budget (`scripts/check-bundle-budget.mjs`, needs a build) |
| `pnpm --filter @manawg/web analytics:check` | PostHog privacy contract (`scripts/check-analytics-privacy.mjs`) |
| `pnpm --filter @manawg/web analyze` | Build with the Next bundle analyzer |

## Quality gates

CI (`.github/workflows/ci.yml`, job `validate`) runs, in this order:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm --dir apps/web analytics:check`
4. `node scripts/check-feature-boundaries.mjs`
5. `node scripts/check-wg-auth-invariant.mjs`
6. `pnpm typecheck`
7. `pnpm --filter @manawg/web test:unit`
8. `pnpm build`
9. `pnpm --filter @manawg/web bundle:check`

Job `e2e-fixtures` (`test:e2e:fixtures`, Chromium) runs on every push to `main` and on PRs only
with the label `run-e2e`. PRs that only touch `**.md` or `docs/**` skip CI. While the repo
variable `PREVIEW_GATE` is `on`, the Preview jobs (`preview-source`, `db-supabase-preview`,
`e2e-preview`) migrate and test the Preview deployment of the current `main` tip.

Before handoff run the same gates locally and report exact results (`AGENTS.md`).

## Cron jobs

Defined in `apps/web/vercel.json` (UTC schedules). Every route requires
`Authorization: Bearer $CRON_SECRET` (`src/core/infra/cron-auth.ts`): without `CRON_SECRET` it
answers `503 cron_secret_missing`, with a wrong header `401`.

| Path | Schedule | Does |
| --- | --- | --- |
| `/api/cron/maintenance` | `45 4 * * *` | Purges expired `idempotency_responses`, retries pending account deletions, deletes tombstoned private images from Supabase Storage, reconciles stale PayPal `capturing` payments (when PayPal is configured). |
| `/api/cron/recurring-advance` | `10 6 * * *` | Turns due, unpaused recurring-expense templates into expenses (max 500 per run, batches of 10) and advances them. |
| `/api/cron/chore-reminders` | `0 8 * * *` | Push reminders for assigned chores due today or overdue up to 7 days (18 h throttle per chore, max 500). |
| `/api/cron/event-reminders` | `0 9 * * *` | Push reminders for calendar events (including recurring occurrences) starting tomorrow (Berlin day). |

## Deployment

- Hosting: Vercel, region `fra1`. Git deployments of `main` are disabled
  (`git.deploymentEnabled.main: false` in `vercel.json`); Production is deployed explicitly by
  the owner. Only `main` exists; work goes through a branch and PR that the owner merges.
- Preview and Production are separate (own Supabase projects and secrets). Never use Production
  credentials in Preview.
- Preview database: CI job `db-supabase-preview` applies and checks migrations with the
  Preview secret `SUPABASE_PREVIEW_DATABASE_MIGRATION_URL`, then `e2e-preview` runs the live
  smoke pack against the Preview URL.
- Production database: only `.github/workflows/migrate-production.yml` (manual dispatch on
  `main`) with inputs `candidate_sha` (full SHA of current `main`), `preview_run_id` (CI run
  whose `db-supabase-preview` and `e2e-preview` passed for that SHA) and the confirmation
  `MIGRATE_PRODUCTION`. It verifies the main push CI for the SHA, the Preview evidence and the
  current `main` tip, requires the direct Production host on port 5432, then runs `db:migrate`
  and `db:check`.
- Local, fixture or Preview success is never Production proof. Do not deploy, migrate or change
  production data without explicit owner approval. Go-live checks:
  [release checklist](docs/release-checklist.md).

## Troubleshooting

| Symptom | Cause / check |
| --- | --- |
| `/api/health` returns 503 `degraded` | `missingRequiredCount > 0` or `database: unreachable`. Variable names are only in the boot log line `[env] MISSING REQUIRED: ...` (`src/instrumentation.ts`), never in the response. |
| API answers `503 rate_limiter_unavailable` | Limiter fails closed when `VERCEL_ENV=production`, `NODE_ENV=test`, or `NODE_ENV=production` without `VERCEL_ENV` (e.g. local `next start`) and Upstash is missing or erroring (`src/core/rate-limit.ts`). Set `UPSTASH_REDIS_REST_URL` (https) and `UPSTASH_REDIS_REST_TOKEN`. |
| Writes answer `403 cross_origin_blocked` | Middleware requires a same-origin `Origin` header on mutating requests to the matched API paths (`/api/wg`, `/api/account`, `/api/auth/*`, `/api/upload/*`, ...). |
| Writes and crons answer `503 migration_read_only` | `MIGRATION_READ_ONLY=true` is set (migration window). |
| Cron answers `503 cron_secret_missing` / `401` | `CRON_SECRET` unset / wrong bearer header. |
| Image upload or read answers `503 feature_disabled` | Storage provider variables missing, or (Supabase) the bucket is not private with an 8 MiB limit and exactly the allowed image MIME types (`src/core/infra/private-image-policy.ts`). |
| Fixture E2E hits the real app instead of fixtures | A fixture condition is missing (e.g. `VERCEL=1` or `POSTGRES_URL` exported in the shell). Use the `test:e2e:fixtures` script. |
| `db:migrate` rejects the URL | Not a direct `*.supabase.co:5432` URL, port `6543`, missing `sslmode`, or extra query parameters. |

## Design language

[Brandbook v1.0](docs/brand/brandbook.html) is the app's visual source of truth.
[Implementation rules](docs/brand/design-language.md) connect it to the shared theme,
components and brand assets.
