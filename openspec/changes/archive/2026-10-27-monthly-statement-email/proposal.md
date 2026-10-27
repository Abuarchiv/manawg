## Why

Members want the month closed without opening the app: on the first of every month each member gets the previous month's statement by e-mail (Brandbook Touchpoints E9 "September ist abgerechnet"). The in-app statement (`/wg/[code]/abrechnung`) already exists; the mail is the push channel for it.

## What Changes

- Daily cron `GET /api/cron/monthly-statements` sends, on the 1st of the month (Berlin), one statement mail per member and WG for the finished month; days 2–5 only retry what failed.
- Mails go out through the Resend HTTP API (same account and domain as the Supabase Auth SMTP), rendered from an inline-styled template that follows E9.
- New ledger table `statement_emails` makes sending idempotent and resumable; a member gets at most one mail per WG and month.
- New preference `wg_members.notify_statement_email` (default on), toggle in Einstellungen → Benachrichtigungen, one-click unsubscribe link plus `List-Unsubscribe` / `List-Unsubscribe-Post` headers.

## Capabilities

### New Capabilities

- `monthly-statement-email`: Who receives the monthly statement mail, when, with which content, and how sending stays idempotent and opt-out-able.

### Modified Capabilities

None.

## Impact

- Schema + additive migration (`statement_emails`, `wg_members.notify_statement_email`); Prod migration via `migrate-production.yml`.
- New env `RESEND_API_KEY` (Production only) and `STATEMENT_EMAIL_FROM` (`ManaWG <noreply@manawg.com>`).
- `vercel.json` gets a fifth cron entry.
- Reuses `buildMonthlyStatement` (`features/expenses/monthly-statement.ts`), `requireCronSecret`, `withCronLogging`. No new npm dependency (Resend via `fetch`).
