# Development

Reference for working on the code. Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for the
workflow and conventions, and [architecture](architecture.md) for how the app is built.

The stack: Next.js 15 App Router, React 19, Supabase Auth, PostgreSQL via Drizzle, Tailwind 4
with shadcn/Base UI, Playwright and `node:test`.

## Layout

```text
apps/web/
  src/app/        routes only: pages, layouts, API handlers (thin, call core/features)
  src/core/       domain-neutral building blocks: db, auth, guards, http, offline, notifications, infra
  src/composition/ cross-feature reads (dashboard, activity, export)
  src/features/   vertical slices (chat, chores, events, expenses, inventory, pinnwand, shopping)
                  a feature may import core/, shared/ and itself, never another feature
                  features/<x>/server/ holds database and server-only code (import 'server-only')
  src/components/ reusable UI: ui/ (shadcn), animate-ui/ (motion variants), app/ (shell, PWA, theme), wg/ (WG-wide)
  src/fixtures/   in-memory fixture build for e2e (see Fixture mode); only src/app/ imports it
  src/shared/     framework-light utilities (lib/, fonts, css): theme, brand, analytics
  drizzle/        SQL migrations (`pnpm --filter @manawg/web db:generate` / `db:migrate`)
  e2e/            Playwright specs (fixture mode needs no database)
  tests/          node:test suites that are not colocated with a module
  scripts/        CI gates and the migrator
docs/             architecture, brand contract, self-hosting, database recovery
openspec/         change proposals and specs (OpenSpec)
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
| `MEMBER_SESSION_SECRET` | Signs calendar feed URLs and verifies legacy-profile recovery proofs (`openssl rand -hex 32`). Not used for normal API access. Rotate by moving the old value to `MEMBER_SESSION_SECRET_PREVIOUS`, so existing feeds keep working. |

In production `SUPABASE_SERVICE_ROLE_KEY` is also required (account deletion, Supabase image storage).

Optional features degrade when unset and are reported as `[env] DEGRADED ...`: Upstash rate
limiting (`UPSTASH_REDIS_REST_*`, fails open outside production), Web Push (`VAPID_*`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), image uploads
(`IMAGE_STORAGE_PROVIDER` plus its provider variables). Every variable is described in `apps/web/.env.example`. Never commit or print
env values.

### Database migrations

```sh
DATABASE_MIGRATION_URL=... pnpm --filter @manawg/web db:migrate   # apply pending migrations
DATABASE_MIGRATION_URL=... pnpm --filter @manawg/web db:check     # verify schema + ledger only
```

`scripts/db-migrate.mjs` does not read `.env` files; export the variable in the shell. It
resolves `DATABASE_MIGRATION_URL` first (then `POSTGRES_URL`/`DATABASE_URL`, then the
non-pooling pair) and only accepts a Supabase session connection on port `5432` (direct host `*.supabase.co` or the
session pooler `*.pooler.supabase.com`), with `sslmode` as the only query parameter. The
transaction pooler port `6543` is rejected.
The official instance is migrated only by its GitHub workflow (see [Releases](#releases-of-the-official-instance)).

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
and the WG layout hands the first fixture member to the provider as the initial identity, without
`authUserId`: the provider is not server-verified there and confirms the account through the member
lookup like in the app. The fixture API answers as the account `FIXTURE_AUTH_USER_ID`
(`src/fixtures/data.ts`): `GET /api/wg/[code]` reports it as `authUserId` and `GET /api/wg/mine`
lists the fixture WGs. The API client needs no fixture switch: it always sends
`x-manawg-expected-member-id`, which the fixture API reads as the caller. Core, components and features receive plain options (`requireWgSignIn`)
and never see fixture mode. Specs that seed the offline queue or open `/offline` before visiting a
WG store that account as `manawg_account` first (`seedLocalAccount` in `e2e/support/helpers.ts`).

## Commands

```sh
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
| `pnpm test` (root) | The unit tests (`test:unit`); Playwright is `pnpm e2e` (dev server with your `.env.local`) |
| `pnpm --filter @manawg/web test:unit` | `node --test` over `src/**/*.test.mjs`, `src/**/*.test.ts` and `tests/*.test.ts` |
| `pnpm --filter @manawg/web test:e2e:fixtures` | Playwright against a production build in fixture mode |
| `pnpm --filter @manawg/web test:e2e:webkit` | WebKit fixture config (`playwright.webkit-fixtures.config.ts`) |
| `pnpm --filter @manawg/web test:e2e:account-delete-db` | Account deletion against a disposable loopback Postgres in `ACCOUNT_DELETE_TEST_URL` |
| `pnpm --filter @manawg/web test:db` | Database-backed unit tests against the loopback Postgres in `TEST_DATABASE_URL` (exits 2 when it is unset) |
| `pnpm --filter @manawg/web test:db-timeouts` | Runtime pool timeouts against a throwaway local Postgres (`RUN_DB_TIMEOUT_INTEGRATION=1` is set by the script) |
| `pnpm --filter @manawg/web bundle:check` | Bundle budget (`scripts/check-bundle-budget.mjs`, needs a build) |
| `pnpm --filter @manawg/web analytics:check` | PostHog privacy contract (`scripts/check-analytics-privacy.mjs`) |
| `pnpm --filter @manawg/web analyze` | Build with the Next bundle analyzer |

### Real-stack checks

Scripts that drive a production build against a local Supabase stack (sign-in, mails, every
module, fuzzing, load) are described in
[`apps/web/scripts/real-stack/README.md`](../apps/web/scripts/real-stack/README.md).

### Opt-in test gates

These tests skip themselves unless their variable is set. `pnpm test:unit` and `test:e2e:fixtures` (the CI lanes) never set them, because each needs something CI does not provide: a database, a public network, or real credentials. The auth UI specs (`e2e/auth-ui.spec.ts`) are not gated: `test:e2e:fixtures` starts a second fixture server on `E2E_PORT` + 1000 whose Supabase browser client points at a fake project (the specs answer its requests through page routes), so they run in CI.

| Variable | Enables | How to run | Why not in CI |
| --- | --- | --- | --- |
| `TEST_DATABASE_URL` | `tests/statement-run-ledger.test.ts`, `tests/db-connection.test.ts` (live transaction check), `src/core/db/private-image-deletions.test.ts` and the real-PostgreSQL case of `e2e/shopping-conflict.spec.ts` | `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/manawg_test pnpm --filter @manawg/web test:db`; the shopping case runs inside `test:e2e:fixtures e2e/shopping-conflict.spec.ts` with the same variable. The URL must be a disposable loopback Postgres with all migrations applied | No Postgres service in the CI jobs; the tests write to the database |
| `RUN_DB_TIMEOUT_INTEGRATION` | The pool timeout case in `tests/runtime-pool.test.ts` | `pnpm --filter @manawg/web test:db-timeouts` (needs `initdb` and `pg_ctl` on the PATH and a non-root user) | Needs local PostgreSQL binaries and takes up to a minute |
| `ACCOUNT_DELETE_TEST_URL` | `e2e/account-delete-db.spec.ts` (account deletion against real data) | `ACCOUNT_DELETE_TEST_URL=postgresql://postgres@127.0.0.1:55432/manawg_test pnpm --filter @manawg/web test:e2e:account-delete-db` (loopback host and explicit port required) | Needs a disposable Postgres; the script refuses to run without it |
| `OCR_RUNTIME_E2E` | The real Tesseract worker proof in `e2e/expense-ui-form.spec.ts` | `OCR_RUNTIME_E2E=true pnpm --filter @manawg/web test:e2e:fixtures e2e/expense-ui-form.spec.ts` | Downloads the WASM core and the German and English models from `cdn.jsdelivr.net` |
| `PREVIEW_E2E` | `e2e/preview-protection.spec.ts` and the Preview branches of `e2e/smoke-launch.spec.ts` | Set by the `e2e-preview` job in `.github/workflows/ci.yml` against a trusted Vercel Preview URL (`BASE_URL`) with `VERCEL_AUTOMATION_BYPASS_SECRET` | Needs a deployed, protected Preview and the bypass secret |
| `REAL_PRODUCT_E2E` | The real-account path of `e2e/smoke-launch.spec.ts` | Same job as `PREVIEW_E2E`, or locally against a hosted `BASE_URL` with the `E2E_SUPABASE_*` credentials | Needs a hosted deployment and a real test account |
| `PUBLIC_ENTRY_E2E` | `e2e/public-entry-live.spec.ts` (hosted public entry) | `BASE_URL=<hosted origin> PUBLIC_ENTRY_E2E=true pnpm --filter @manawg/web exec playwright test public-entry-live.spec.ts` | Needs a deployed app on real Supabase |
| `AUTH_LIVE_E2E` | `e2e/social-login-live.spec.ts` (OAuth callback errors) | `BASE_URL=<hosted origin> AUTH_LIVE_E2E=true pnpm --filter @manawg/web exec playwright test social-login-live.spec.ts` | Needs a deployed app on real Supabase |
| `SUPABASE_AUTH_LIVE_E2E` | `e2e/supabase-auth-live.spec.ts` (live sign-in and session checks; needs `SUPABASE_AUTH_TEST_EMAIL`, `SUPABASE_AUTH_TEST_PASSWORD` and the member WG variables) | `BASE_URL=<hosted origin> SUPABASE_AUTH_LIVE_E2E=true pnpm --filter @manawg/web exec playwright test supabase-auth-live.spec.ts` | Needs a deployed app and real test credentials |
| `SUPABASE_AUTH_PASSWORD_RESET_SMOKE` | The no-session password reset page check in `e2e/supabase-auth-live.spec.ts` (sends no e-mail) | `BASE_URL=<hosted origin> SUPABASE_AUTH_PASSWORD_RESET_SMOKE=true pnpm --filter @manawg/web exec playwright test supabase-auth-live.spec.ts` | Needs a deployed app on real Supabase |

`PREVIEW_E2E`, `REAL_PRODUCT_E2E`, `PUBLIC_ENTRY_E2E`, `AUTH_LIVE_E2E`, `SUPABASE_AUTH_LIVE_E2E` and `SUPABASE_AUTH_PASSWORD_RESET_SMOKE` are set to `true` by the `e2e-preview` job of the CI workflow; `test:e2e:fixtures` sets `PREVIEW_E2E`, `REAL_PRODUCT_E2E`, `PUBLIC_ENTRY_E2E`, `AUTH_LIVE_E2E` and `SUPABASE_AUTH_LIVE_E2E` to `false`.

## Quality gates

CI (`.github/workflows/ci.yml`, job `validate`) runs, in this order:

1. `pnpm install --frozen-lockfile`
2. `pnpm audit --prod --audit-level high`
3. `pnpm lint`
4. `pnpm knip` (unused files, exports and dependencies; config in `knip.json`)
5. `pnpm --dir apps/web analytics:check`
6. `pnpm --filter @manawg/web exec node scripts/check-architecture.mjs`
7. `pnpm --filter @manawg/web exec node scripts/check-wg-auth-invariant.mjs`
8. `pnpm typecheck` (app, plus `tsconfig.e2e.json` for `e2e/`, `tests/*.test.ts` and Playwright configs)
9. `pnpm --filter @manawg/web test:unit`
10. `pnpm build`
11. `pnpm --filter @manawg/web bundle:check`

`validate` runs on every PR (drafts and docs-only PRs included) and every push to `main`. Job
`e2e-fixtures` (`test:e2e:fixtures`, Chromium) runs on every non-draft PR and every push to
`main`. While the repo variable `PREVIEW_GATE` is `on`, the Preview jobs (`preview-source`,
`db-supabase-preview`, `e2e-preview`) migrate and test the Preview deployment of the current
`main` tip. Dependabot (`.github/dependabot.yml`) opens one grouped minor/patch PR per week and
ecosystem (npm, GitHub Actions, Docker) and a separate PR per major update; third-party actions
are pinned by commit SHA.

Workflow `security.yml` runs Trivy over the lockfile, the Dockerfile and the tree (known
vulnerabilities, misconfigurations, secrets) on every PR, on `main` and weekly. Workflow
`docker.yml` builds the self-hosting image and scans it with Trivy when a PR touches the image
inputs; `scorecard.yml` publishes the OpenSSF Scorecard.

Run the same gates locally before you open a pull request.

## Cron jobs

Defined in `apps/web/vercel.json` (UTC schedules). Every route requires
`Authorization: Bearer $CRON_SECRET` (`src/core/infra/cron-auth.ts`): without `CRON_SECRET` it
answers `503 cron_secret_missing`, with a wrong header `401`.

| Path | Schedule | Does |
| --- | --- | --- |
| `/api/cron/maintenance` | `45 4 * * *` | Purges expired `idempotency_responses`, retries pending account deletions, deletes tombstoned private images from Supabase Storage. |
| `/api/cron/recurring-advance` | `10 6 * * *` | Turns due, unpaused recurring-expense templates into expenses (max 500 per run, batches of 10) and advances them. |
| `/api/cron/chore-reminders` | `0 8 * * *` | Push reminders for assigned chores due today or overdue up to 7 days (18 h throttle per chore, max 500). |
| `/api/cron/event-reminders` | `0 9 * * *` | Push reminders for calendar events (including recurring occurrences) starting tomorrow (Berlin day). |
| `/api/cron/monthly-statements` | `0 7 1-5 * *` | Mails the statement of the finished month. Day 1 sends; days 2–5 retry what failed or was deferred by the provider quota. |

## Releases of the official instance

app.manawg.com runs on Vercel (region `fra1`) with separate Supabase projects for Preview and
Production. Git deployments of `main` are off; the maintainer releases explicitly:

1. While the repository variable `PREVIEW_GATE` is `on`, CI migrates the Preview database
   (`db-supabase-preview`) and runs the live smoke pack against the Preview deployment
   (`e2e-preview`).
2. `.github/workflows/migrate-production.yml` (manual dispatch) migrates Production only for the
   current `main` SHA with passing push CI and Preview evidence.
3. `.github/workflows/release-production.yml` deploys that SHA.

These workflows only run in `Abuarchiv/manawg-app`. Self-hosted instances follow
[self-hosting](self-hosting.md).

## Versioned releases

Self-hosters run tagged versions. To cut one:

1. Move the entries under `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a new
   `## [X.Y.Z] - YYYY-MM-DD` section ([Semantic Versioning](https://semver.org/): a release that
   needs a manual step for self-hosted instances is a major one) and merge that change.
2. Tag the merge commit on `main` and push the tag:

   ```sh
   git tag -s vX.Y.Z -m "ManaWG X.Y.Z"
   git push origin vX.Y.Z
   ```

3. `.github/workflows/docker.yml` builds `linux/amd64` and `linux/arm64` and pushes
   `ghcr.io/abuarchiv/manawg-app` as `X.Y.Z`, `X.Y`, `X` and `latest`. Make the package public
   once under the repository's **Packages** settings.
4. Create the GitHub release from the tag with the changelog section as notes.

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
| `db:migrate` rejects the URL | Not a Supabase session connection on port `5432`, port `6543`, missing `sslmode`, or extra query parameters. |
