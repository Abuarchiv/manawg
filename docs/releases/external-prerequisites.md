# External release prerequisites

This checklist belongs to the release owner. The workflow changes in this
candidate have not been operated against Preview or Production locally. No
secret values belong in this file, workflow logs, or the release record.

## Protected Preview environment

GitHub environment `Preview` must be protected and contain these secrets:

- `SUPABASE_PREVIEW_DATABASE_MIGRATION_URL`: direct ManaWG Preview Supabase
  PostgreSQL URL, host `db.sthiwjebcwwiphashgla.supabase.co`, port `5432`.
  Transaction pooler port `6543` is rejected.
- `E2E_SUPABASE_URL`: `https://sthiwjebcwwiphashgla.supabase.co/` with no
  path, query, fragment, or port.
- `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_TEST_EMAIL`, and
  `E2E_SUPABASE_TEST_PASSWORD`: the dedicated Preview QA account used by the
  existing real-product smoke.
- `SUPABASE_AUTH_TEST_EMAIL`, `SUPABASE_AUTH_TEST_PASSWORD`,
  `SUPABASE_AUTH_TEST_MEMBER_WG_CODE`, and `SUPABASE_AUTH_TEST_MEMBER_NAME`:
  the dedicated member identity and existing disposable WG used by
  `supabase-auth-live.spec.ts`. The workflow maps and requires all four.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: the protected Preview bypass secret.

Vercel must send a successful `Preview` deployment-status event created by
`vercel[bot]`, with deployment ref `main` or the full deployment SHA matching
`deployment.sha`, source revision equal to the checked-out `main` SHA, and a target origin matching
`https://manawg-<deployment>-abditubes-projects.vercel.app` exactly. The
workflow rejects credentials, ports, paths, queries, fragments, unrelated
hosts, other actors, and event-supplied refs before protected test credentials
are loaded.

Before claiming auth coverage, the Supabase project owner must verify the Site
URL, callback allowlist, email/SMTP confirmation and recovery behavior, and any
enabled Google or phone/SMS/CAPTCHA/limit configuration. Disabled methods need
an explicit product decision; a skipped method is not Preview evidence.

## Protected Production environment

GitHub environment `Production` must remain protected and contain
`DATABASE_MIGRATION_URL` for the direct ManaWG Production Supabase host
`db.bwsvsvfgbrsonepffqff.supabase.co` on port `5432`. The workflow does not
accept a pooler endpoint.

The production migration workflow requires all of these dispatch inputs:

- `candidate_sha`: the full 40-character SHA currently checked out from
  `main`.
- `preview_run_id`: the completed CI run ID for the same SHA whose
  `db-supabase-preview` and `e2e-preview` jobs both passed.
- `confirmation`: exactly `MIGRATE_PRODUCTION`.

The dispatch ref must be `main`. A stale candidate, a moved `main`, a missing
or failed Preview run, a different run SHA, or a missing required confirmation
stops before the production database secret is used. Immediately before that
connection step, the workflow performs a read-only `git ls-remote` check of
`origin`'s current `refs/heads/main` and compares it with `candidate_sha`.
This is a cutover check, not a repository freeze: a push after the check can
still move `main`, so the release owner must keep the migration window quiet
and treat any such push as stale evidence that requires a new candidate and
Preview run. If `main` advances after Preview, pin the new SHA and repeat the
full Preview gate; do not reuse the older run ID.

## Owner commands and sequence

Run local source and pure gate checks from the repository with Node 22 and the
repository's pnpm 9 tool:

```sh
export PATH=/tmp/manawg-product-tools:/opt/homebrew/opt/node@22/bin:$PATH
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @manawg/web bundle:check
pnpm --filter @manawg/web test:e2e:fixtures
BASE_URL=https://example.invalid E2E_PORT=3112 pnpm --filter @manawg/web exec playwright test release-workflow-gates.spec.ts --reporter=line --retries=0
```

The `example.invalid` command exercises only pure gate logic and makes no
network request. Use a unique `E2E_PORT` such as `3112` whenever a local
Playwright command starts a server; do not share `.next` with another build.

After the Preview environment and Vercel event path are authorized, the CI
Preview job runs this explicit pack against the validated target:

```sh
pnpm --filter @manawg/web exec playwright test --retries=0 \
  preview-protection.spec.ts smoke-launch.spec.ts public-entry-live.spec.ts \
  social-login-live.spec.ts supabase-auth-live.spec.ts
```

Record the CI run ID, target origin, source SHA, migration/check result,
Playwright result and artifacts. For the production step, select the
`Migrate production database` workflow on `main`, enter the approved
`candidate_sha`, the matching successful Preview `preview_run_id`, and the
exact confirmation. The workflow itself performs the final direct-connection
guard, migration, and `db:check`; do not dispatch it until the release owner
has approved the migration window and rollback/recovery evidence.

Local lint, build, fixture, and pure gate results do not prove hosted Preview
authentication, Supabase migration state, provider callbacks, production
data integrity, or a production canary. Those claims remain `BLOCKED` until
the owner records the corresponding external evidence.

## Stand 2026-10-01 (ersetzt die gelöschten Gate-Notizen vom 2026-09-27)

- Upstash-Rate-Limit-Analytics: SDK-Analytics seit dem Release vom 2026-09-30 aus; die 552 historischen Analytics-Keys wurden am 2026-09-30 gelöscht (Readback: 0 verbleibend). Gate geschlossen.
- Sentry: DSN-Zuordnung und EU-Ingestion sind belegt; Retention/automatische Löschung und ein echter Alert-Mail-Empfang bleiben offen (siehe oben). Keine Lösch-/Aufbewahrungsaussage veröffentlichen, bis das belegt ist.

