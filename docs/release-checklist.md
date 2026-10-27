# Release checklist

Manual go-live checks that code and CI cannot guarantee. Work through them for every Production
release, record evidence in `docs/releases/`, and never write secret values anywhere. GitHub
environment setup, Preview secrets and workflow inputs: see
[external prerequisites](releases/external-prerequisites.md). Rollback and restore:
[database recovery](database-recovery.md).

## Before migrating

- [ ] CI on the candidate `main` SHA is green (`validate`, `e2e-fixtures`), and the Preview gate
      (`db-supabase-preview`, `e2e-preview`) passed for the same SHA. Note the run ID for
      `preview_run_id`.
- [ ] A fresh, verified database backup exists. Hosted Supabase backups/PITR are **unverified**
      (`database-recovery.md`); the operator-owned local export only counts with `status: success`
      and a fresh completed directory.
- [ ] Migration window approved by the owner. If writes must stop, set `MIGRATION_READ_ONLY=true`
      and remove it afterwards.
- [ ] Migrations `0018_member_fk_indexes` and `0019_push_subscription_per_member` (index changes only) build their indexes in one transaction each; writes to those
      tables wait until they commit. Run them in a quiet window (seconds at today's data size).
- [ ] Production migration only via `.github/workflows/migrate-production.yml` on `main`
      (`candidate_sha`, `preview_run_id`, `MIGRATE_PRODUCTION`). Never run `db:migrate` against
      Production from a laptop, and never use Production credentials in Preview.

## Production environment (Vercel)

Names only. `checkEnv` (`apps/web/src/core/infra/env.ts`) treats these as required when
`VERCEL_ENV=production`; a gap shows up as `[env] MISSING REQUIRED: ...` in the boot log and
`missingRequiredCount > 0` in `/api/health`.

- [ ] `POSTGRES_URL` (or `DATABASE_URL`)
- [ ] `MEMBER_SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `CRON_SECRET`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (account deletion; missing it makes `/api/health` answer 503)
- [ ] `UPSTASH_REDIS_REST_URL` (https) and `UPSTASH_REDIS_REST_TOKEN`
- [ ] Image storage for the configured provider:
      `supabase`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (plus an https
      `NEXT_PUBLIC_SUPABASE_URL`);
      `aws`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`
      (`S3_PUBLIC_URL` must be https if set).

Not fatal, but expected in Production:

- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (push; `VAPID_SUBJECT`
      throws in production when push is used without it).
- [ ] `NEXT_PUBLIC_APP_URL` (invite links, OG images, PayPal return origin).
- [ ] `NEXT_PUBLIC_SENTRY_DSN` set, so errors are reported at all.
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` if
      analytics should run (any other host disables it).
- [ ] PayPal: all `PAYPAL_*`/`NEXT_PUBLIC_PAYPAL_*` empty (off) or a complete live set
      ([paypal-setup.md](paypal-setup.md)). No sandbox values in Production.
- [ ] `MIGRATION_READ_ONLY` unset or not `true` after the migration window.

## Configuration the code cannot check

- [ ] `IMAGE_STORAGE_PROVIDER=supabase`. The legacy `aws` default stores public image URLs and
      has no delete path, so deleted images stay reachable in the bucket.
- [ ] Supabase Storage bucket is private, limit 8 MiB, MIME types exactly `image/jpeg`,
      `image/png`, `image/webp`, `image/heic`, `image/heif`; otherwise uploads and reads answer
      503 (`apps/web/src/core/infra/private-image-policy.ts`).
- [ ] `POSTGRES_URL` points at the Supavisor transaction pooler (port `6543`).
- [ ] The pooler can absorb up to 5 runtime connections per warm function instance (one pool
      for queries and transactions, `apps/web/src/core/db/index.ts`). If both `POSTGRES_URL` and
      `DATABASE_URL` are set they must be equal; otherwise the server logs
      `[db] ... both set but differ`.
- [ ] Vercel function max duration (Fluid compute) is long enough for the four crons in
      `apps/web/vercel.json`; no route sets `maxDuration`, so the project default applies.
- [ ] Supabase Auth: Site URL `https://app.manawg.com`, redirect allowlist includes
      `https://app.manawg.com/auth/callback` (called with `?next=...`), SMTP for confirmation
      and password-reset mail, enabled social providers configured.
- [ ] PostHog project setting "Discard client IP data" is on.
- [ ] Sentry project receives events from the Production DSN (EU ingestion, retention and alert
      recipients per `releases/external-prerequisites.md`).
- [ ] Legal pages are live and current: https://manawg.com/impressum,
      https://manawg.com/datenschutz, https://manawg.com/agb (linked from
      `apps/web/src/components/entry/LegalLinks.tsx`).

## After deploying

- [ ] `GET https://app.manawg.com/api/health` returns 200 with `"status":"ok"`,
      `"database":"ok"`, `"missingRequiredCount":0`; check `degradedFeatures` is what you expect.
      Do this before announcing the release.
- [ ] Boot log has no `[env] MISSING REQUIRED` line.
- [ ] Smoke with the Production test account (`AGENTS.md`) and a disposable WG: create the WG,
      expense, shopping item, chore, chat message, pinnwand post, CSV export; delete the WG
      (as in `releases/2026-10-01-release-evidence.md`).
- [ ] Next cron runs succeed (Vercel cron logs; `/api/cron/maintenance` returns `ok: true`).
- [ ] Record SHA, CI/Preview run IDs, migration run and health result in `docs/releases/`.

## Offene Hosted-Nachweise

Tasks of OpenSpec changes whose code is in `main` and which only need hosted Preview or Production
evidence. Each is an owner action; tick the line and record the evidence in `docs/releases/`.

- [ ] `add-privacy-safe-product-analytics` 2.2: Create the PostHog EU organization/project, configure the hosted environment, and prove live event ingestion.
- [ ] `add-rls-defense-in-depth` 3.1: Apply and verify the migration in Preview under release/database ownership; retain catalog and direct anonymous/authenticated client-denial evidence.
- [ ] `add-rls-defense-in-depth` 3.2: Run the required application fixture and protected Preview gates against the rehearsed build and verify no server-side route regression.
- [ ] `add-rls-defense-in-depth` 3.3: Promote to Production only after the Preview handoff, exact ledger/RLS/access checks, and Terra review are green; record rollback readiness and leave the task open if any external evidence is missing.
- [ ] `add-signup-page` 4.3: Hosted check in Preview (real confirmation mail, redirect allowlist) before promotion.
- [ ] `app-audit-2026-10` 14.4: Check manually: HEIC conversion on iPhone, join toggle refresh, rename, rotation and push opt-out flows.
- [ ] `establish-playwright-verification` 4.3: Use the dedicated QA identity and a unique run-tagged namespace to exercise launch, authenticated household access, and one representative mutation/read flow against the validated Preview; require successful removal of created data before passing and verify one authorized run passes while cleanup failure returns non-zero with the namespace reported.
- [ ] `establish-playwright-verification` 4.4: Emit the validated Preview origin, deployment identifier, source revision, execution mode, and result as reviewable CI evidence without secrets; verify target, source, authentication, flow, and cleanup failures return non-zero.
- [ ] `harden-account-deletion` 5.3: After application code changes, update the knowledge graph with `graphify update .` and obtain an independent review of authorization, lock order, rollback/retry behavior, and retained data; verify every actionable finding is resolved on the final candidate SHA.
- [ ] `harden-account-deletion` 5.4: Record exact-SHA hosted Preview migration/Auth checks and any external blockers separately from local evidence; verify service-role availability and the provider's missing-user behavior without exposing credentials, and keep the PR open if required Preview/Auth/RLS gates remain failed.
- [ ] `monthly-statement-email` 4.2: Prod migration, deploy, first real run on the 1st with log check.
- [ ] `private-attachment-deletion` 4.3: Document schema-first deployment and compatible reader/writer cutover, including inaccessible/drained old deployments and fence-aware rollback. The design is documented; exact-SHA hosted Preview migration, create/read/revoke, and provider-removal proof remains unrun.
- [ ] `public-dashboard-entry` 2.1: Run Luna browser E2E against an authorized hosted preview backed by Supabase; verify guest navigation, create/invite transitions, member welcome, and mobile layout.
