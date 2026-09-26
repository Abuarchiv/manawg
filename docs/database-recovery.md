# ManaWG database recovery and release runbook

Scope: hosted Supabase PostgreSQL and Auth, AWS S3 uploads (Supabase Storage if used), Upstash and Vercel. No local PostgreSQL substitute or custom backup service.

**Status: documented procedure, not recovery evidence.** Repository behavior was inspected on 2026-09-03. Provider plans, backup/PITR availability and retention, restore capability, Auth settings, object protection, environment secrets and approval rules remain **UNVERIFIED** until an operator records current evidence. This document authorizes no remote action and does not declare ManaWG release-ready.

## Authority and stop conditions

- Name a release approver, migration operator and recovery owner/on-call. Record explicit approval for the exact production project, source SHA, migration window and permitted writes. Deployment, provider configuration, paid restore resources, production restore and traffic cutover each need authorization.
- Use secret-manager/GitHub environment references only. Never record connection strings, passwords, API keys, cookies, OTPs, signed URLs, raw Auth rows or customer data in this file, logs or tickets. Store sanitized evidence in restricted incident/release records.
- **STOP** for missing/expired recovery evidence, unapproved RPO/RTO, wrong project/ref, missing connection secret, unknown commit outcome, unexplained schema/ledger/security drift, failed hosted rehearsal, unsafe app/schema compatibility or uncontained external side effects. Do not bypass a failing check or rerun blindly.
- Do not reset a shared Preview, overwrite Production, delete a source project, rewrite applied migrations or manually mark migrations applied. A workflow confirmation string is not independent approval. Verify an enforceable approval path; absent one, do not dispatch.

## Pre-migration evidence — required for each release

The recovery owner completes this record before approval; blanks and “unknown” fail the gate.

| Evidence | Required record |
| --- | --- |
| Target and revision | Supabase project/environment/region; approved main SHA; pending migration list; matching Vercel candidate and previous compatible deployment IDs. |
| Recovery point | Provider backup ID/status and successful UTC timestamp, or PITR target within the observed earliest/latest recoverable UTC window; evidence capture time and restricted link. |
| Retention | Actual backup retention, PITR enabled/disabled and retention, expiry of the selected point, restore eligibility and known exclusions. Keep the point available through the rollback window. |
| Recovery objectives | Approved RPO (maximum acceptable lost writes) and RTO (maximum outage through verified service recovery), numeric durations, owner/on-call and approver. Selected point must meet RPO; measured drill must support RTO. |
| Auth hardening | Current provider evidence that Supabase leaked-password protection is enabled, supported sign-in methods and redirect URLs are correct, and no secrets are recorded in the release record. |
| Reconciliation baseline | Consistent snapshot/time: per-table counts and restricted checksums/aggregates, financial totals, UUID relationships, ledger hashes/timestamps, security catalog, Auth/member links and object manifest/version evidence. |
| Recovery readiness | Dated isolated drill result, measured duration, unresolved exceptions, Auth/config and storage recovery coverage, access verification and approved provider costs. |
| Release proof | Successful CI and hosted Supabase migration/product rehearsal for the exact candidate SHA, reviewer approval and rollback compatibility decision. Local/fixture checks are not hosted proof. |

Supabase backup/PITR support depends on the actual project configuration. Database backups do **not** recover Storage object contents; AWS S3 needs separate object/version recovery evidence. Verify availability in the provider, not from a plan name or this document. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

## Free local recovery point

The current Free-plan fallback is an **operator-owned local export**, not a hosted backup or a substitute for the approval gates above. On the operator's Mac, `~/Library/LaunchAgents/com.abu.manawg-local-backup.plist` runs `~/.local/bin/manawg-local-backup.py` daily at 03:15 local time and at login. The script requires the existing Supabase and Vercel CLI sessions. Check `launchctl print gui/$(id -u)/com.abu.manawg-local-backup` and `~/.local/share/manawg-recovery/backup-status.json`; only `status: success` with a fresh completed directory is a recovery point. Ordinary failures write `failed`, abrupt termination can leave `running`, and an early filesystem failure can leave an older status; always compare timestamps and the LaunchAgent exit. A failed status write after the final directory rename can leave a completed-looking directory that is **unverified** until its manifest and status are reconciled.

Each completed directory holds private `roles.sql`, `schema.sql`, `data.sql`, a managed Auth/Storage schema **reference**, a manifest with file SHA-256/size, and downloaded Supabase Storage objects. The script checks Production project identity, current Supabase-storage configuration, required COPY sections, supported app image keys, object count and image references. Unknown keys or historical external image URLs fail closed. Directories must be `0700`, files `0600`, and the local disk encrypted. The current private drill record verifies a no-network restore with exact row sets and sequence values; do not put its raw Auth rows, secrets or object bytes in Git or tickets.

For an isolated local drill, start a disposable Supabase PostgreSQL 17 container with no network and temporary data storage. Create a **blank database**, then apply the captured managed-schema reference there before the role/schema/data dumps. The image's preinitialized `auth` schema may be older than Production; loading data into it failed on missing `auth.audit_log_entries.ip_address` and OAuth tables during the September 2026 drill. Import the role/schema/data dumps in one transaction with `session_replication_role = replica`, then verify all COPY row sets, sequences, Auth/member and expense relationships, RLS and effective grants; confirm a new session has `session_replication_role = origin`. The managed reference is **not** an approved script to apply wholesale to a hosted Supabase project.

This local method has no guaranteed RPO while the Mac is off, sleeping or unauthenticated. SQL dump commands do not share one database snapshot; Storage bytes and Auth/provider, Vercel, payment and notification configuration have separate recovery boundaries. No offsite copy, hosted application login, numeric RPO or measured service RTO follows from a successful local import. The first natural calendar-triggered backup remains a separate check. Local evidence does not waive leaked-password protection, exact-SHA Preview CI or real-user acceptance.

## Safe production migration

Use the existing [manual GitHub workflow](../.github/workflows/migrate-production.yml), not ad-hoc production SQL.

1. Review the exact main SHA and pending SQL. Compare the existing ledger to the canonical **applied prefix**, including hashes, timestamps and any documented baseline adoption. Pending migrations are legitimate; unexplained gaps/duplicates are not. The current full `db:check` expects all migrations, so it is not a pending-prefix preflight. Rehearse upgrades, applicable baseline adoption, failure/retry and a second no-op migration on disposable hosted Supabase first.
2. Complete the evidence table and approval. Verify GitHub `Production` access/protection and the `DATABASE_MIGRATION_URL` secret without revealing it. The workflow requires the configured Production direct Supabase host on explicit port **5432**; do not substitute the runtime transaction pooler (6543), a Session Pooler or localhost. The script, not the broader environment-example wording, is authoritative for this workflow.
3. With authorization, deploy/activate `MIGRATION_READ_ONLY=true` and verify the intended API mutation/cron requests return 503. This [middleware gate](../apps/web/src/middleware.ts) is **not a database-wide freeze**: contain other writers, Auth changes, uploads, payment callbacks and scheduled/external jobs separately; drain in-flight work and record the final write boundary. Confirm queued offline retries will not replay unreconciled writes on reopening.
4. In GitHub Actions, select **Migrate production database**, approved `main`, and enter `MIGRATE_PRODUCTION`. Confirm the resolved run SHA equals the approved SHA before application; do not approve a moved ref. The current workflow uses `Production`, serializes migration runs, installs with Node 22/frozen lockfile, then runs `pnpm --filter @manawg/web db:migrate` followed by `pnpm --filter @manawg/web db:check`. It does not itself enforce recovery evidence, main-only execution or same-SHA hosted proof; those are mandatory operator gates here.
5. Observe logs and database activity within the approved time budget. The [migrator](../apps/web/scripts/db-migrate.mjs) takes an advisory lock. A stalled/lost/cancelled run is an **unknown outcome**, not proof of rollback: establish session/transaction and ledger state before any retry. Escalate exceeded time budgets to the recovery owner.
6. Require migration and post-check success, then independently verify the acceptance matrix below. `db:check` checks schema/ledger/data invariants plus the intended public-catalog RLS, role privileges, policies, views and functions; it creates/inserts into a temporary table before rollback. It is not SELECT-only and is not proof of restore, ACLs outside that scope or external consistency.
7. After separate deployment approval, release the compatible app, verify the actual production deployment/SHA, domain, health and authenticated smoke. Reconcile payment/storage/retry state before reopening writes. Recovery owner signs off, restores authorized schedules/traffic progressively and monitors errors, DB connections, auth, uploads and duplicate writes for the agreed observation window.

## Choose the recovery action

| Situation | Action and proof required |
| --- | --- |
| Failed migration transaction | Keep writes closed; inspect schema and ledger against the pre-run evidence. Pending Drizzle SQL/ledger work is transactional, but baseline adoption occurs separately. Confirm rollback and any adoption effects before a reviewed retry. Never infer “nothing changed” from a red workflow. |
| Application rollback | Revert/promote only the approved previous compatible Vercel deployment. This does not undo database changes or recover dropped data. Prove it supports the current schema, data and Auth contract; retain new writes. If incompatible, stay closed and choose forward repair or restore. |
| Committed migration or post-check failure | Treat changes as committed until proven otherwise. Prefer a reviewed forward repair migration with its own recovery point, hosted rehearsal and approval. Do not edit old migration SQL, erase ledger rows or apply speculative down-migrations. |
| Data loss/corruption requiring restore | Recovery owner authorizes target point, destination, outage and accepted loss. Preserve incident evidence and the damaged source where possible. Use the supported provider restore procedure; reconcile writes and external effects after the target point before cutover. A database restore does not reverse a captured payment, delivered notification or changed object. |

## Isolated hosted restore drill

1. Obtain approval for a new disposable hosted Supabase target, cost, restricted production-data handling and cleanup. Never use Production or the shared Preview as the restore destination. Choose a documented backup/PITR point and start the recovery clock.
2. Verify the provider-supported method and target isolation **before** restoring. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project) requires eligible provider configuration; it copies database/Auth data, not a complete application environment. If unavailable, stop for an approved provider-supported alternative; do not invent backup tooling.
3. Prevent outbound effects: inspect copied database jobs/extensions/triggers; ensure they cannot contact live recipients/services. Keep Vercel cron, email/SMS/push, payment capture and production storage writes disabled or isolated. If this cannot be guaranteed, do not start the drill. Use separate test credentials, protected Vercel preview, isolated Upstash and storage destinations; no production traffic/DNS changes.
4. Restore the selected point. Record provider completion, then explicitly configure the isolated runtime and Auth redirect/provider settings through authorized secret references. Do not assume API keys, Auth settings, Storage configuration or Vercel environments were restored. Test fresh sign-in, not just an existing browser session.
5. Run the acceptance checks against the restored point and its matching code/schema revision **before** upgrading it. Then rehearse the candidate migration, intentional failure/retry on disposable data and second-run idempotence. Never run the production workflow against the drill target.

| Acceptance area | Required evidence; any unexplained mismatch fails |
| --- | --- |
| Data | Compare all application tables, counts, deterministic aggregates/checksums, financial totals, UUIDs, FK relationships and representative records to the recovery-point baseline. Account explicitly for writes outside that point; an empty database with valid schema fails. |
| Drizzle ledger | Preserve `drizzle.__drizzle_migrations`; compare ordered canonical hashes/timestamps and documented adoption history to the matching revision. Validate constraints/indexes and data invariants; after candidate upgrade, run its full `db:check`. |
| RLS and grants | Inspect RLS flags/policies plus effective table/sequence/schema/function privileges (including `PUBLIC`, role inheritance and default privileges), views and privileged functions. Compare to approved security intent, not merely a possibly unsafe backup. Prove `anon`/`authenticated` cannot directly read or mutate private app data and the intended server role still works. Missing required RLS or unexpected grants block release. |
| Auth/member links | Preserve Auth UUIDs/identities and `wg_members.auth_user_id`; no new orphaned links, duplicate per-WG account links or changed membership rights. Account for legacy null links explicitly; never claim by name/code alone. Verify authorized recovery with existing proof and negative non-member/deactivated/cross-WG cases. |
| S3 / Storage | Reconcile DB references with actual isolated object bytes, keys, versions/checksums and access rules; test image read/upload with disposable content. Record missing/deleted objects and separate recovery coverage. Storage metadata alone is insufficient. |
| Payment state | Reconcile `expense_payments` order IDs/status/amounts/currency and settlement/debt state with authoritative PayPal records, especially `capturing` and post-point captures. Use sandbox for mutation tests; never replay capture/refund or mark paid from restored DB state alone. |
| Upstash / Vercel | Verify isolated rate limits and audit dedup, PostgreSQL-backed response replay, environment-to-project mapping, connection modes, protected preview, auth callbacks and cron containment. Do not treat Redis as the durable payment/expense ledger or flush shared keys. Review stale browser/offline/service-worker state before traffic resumes. |
| Authenticated product smoke | In a real browser against the hosted target: public browse, configured sign-in/confirmation/reset and SMS if enabled; create WG, invite/join, reload persistence; expenses, shopping, chores, calendar, chat and attachment read/write with approved disposable users. Verify outsider denial and no private response/cache after sign-out. Record actual pass/fail/blocked; mocks or test discovery do not count. |

6. Stop the clock only after verified service readiness. Record elapsed recovery time versus RTO and actual unrecovered writes versus RPO. Release approval requires every applicable check to pass; unavailable providers/tests stay blocked, not silently skipped. Owner approves evidence retention and exact isolated-resource cleanup; record completion without deleting the source or its backups.

## Incident / drill record template

Keep the completed record in an access-controlled system; put only its sanitized reference in release notes.

```text
Record ID / incident or drill / UTC start:
Impact, affected project/environment, first/last affected write:
Incident commander / recovery owner / operator / approver:
Approved action, target, SHA, window and authority reference:
RPO / RTO; backup ID or PITR UTC point/window; retention/expiry:
Recovery evidence and prior drill references (restricted, no secrets):
Before: app deployment, schema/ledger, data/security/object baselines:
Containment and write-drain evidence; external effects/retries held:
Timeline: UTC, actor, action/run ID, observed result, decision:
Outcome certainty: rolled back / committed / unknown; supporting evidence:
Chosen path: failed-transaction retry / app rollback / forward repair / restore:
After: deployment/SHA, data/ledger/security/Auth/storage/payment/smoke results:
Lost/reconciled writes and external effects; actual RPO / measured RTO:
Reopening approval/time, monitors, observation window and follow-up owner:
Unresolved blockers; evidence retention; isolated cleanup approval/result:
```
