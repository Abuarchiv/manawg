## 1. Data

- [x] 1.1 Schema + migration: `statement_emails` (unique member_id+month_key, RLS on, no Data API grants) and `wg_members.notify_statement_email boolean not null default true`.
- [x] 1.2 Recipient query: active members with confirmed `auth.users` e-mail and preference on, per WG; unit-test eligibility rules (participation, ≥2 participants).

## 2. Mail

- [x] 2.1 E9 template (inline styles, table layout, same header/footer as `supabase/templates/`), three status variants; preview script renders all three.
- [x] 2.2 Resend transport via `fetch` (batch endpoint, Idempotency-Key, 429 handling) + dry-run transport outside production.
- [x] 2.3 Signed unsubscribe token, `GET/POST /api/email/unsubscribe`, List-Unsubscribe headers.

## 3. Cron and settings

- [x] 3.1 `/api/cron/monthly-statements` with `requireCronSecret`, `withCronLogging`, Berlin day 1–5 gate, claim/send/mark loop; ledger regression test for double invocation, retries, skipped revival and interrupted rows (`apps/web/tests/statement-run-ledger.test.ts`, opt-in: `TEST_DATABASE_URL`, `pnpm test:db` = disposable local Postgres with all migrations applied).
- [x] 3.2 `vercel.json` cron `0 7 * * *`.
- [x] 3.3 Toggle "Monatsabrechnung per E-Mail" in Einstellungen → Benachrichtigungen.

## 4. Release

- [x] 4.1 `RESEND_API_KEY` set in Vercel Production 2026-10-10 (sending-access key, sender defaults to noreply@manawg.com). Manual cron call is not possible: `CRON_SECRET` is a sensitive variable; evidence comes from the scheduled runs and `mail_log`.
- [ ] 4.2 Prod migration, deploy, first real run on the 1st with log check.
