## Why

The Brandbook Touchpoints document defines ten mails. Four of them (E2–E5) are Supabase Auth templates and E9 is the monthly statement; the other five did not exist. Members without push never heard about anything in their WG, invitations could only be shared as a link, and accounts were created and deleted without a word.

## What Changes

- E1 welcome mail after the first sign-in of a new account (auth callback).
- E6 invitation by e-mail: `POST /api/wg/[code]/invitations`, form under the share card in Einstellungen; the address is never stored (only a hash in the dedupe key).
- E7 daily digest: `GET /api/cron/daily-digest` (06:30 UTC) for members without push, listing chores due today, expenses of the last 24 h, events tomorrow and low stock; nothing is sent when nothing happened. New preference `wg_members.notify_digest_email`.
- E8 reminder mail: when a creditor reminds a debtor who has no push, the reminder also goes out as a mail with the open items.
- E10 account-deleted mail after the Auth user is gone (immediate and via the maintenance retry).
- Shared mail shell (`core/mail/brand-mail.ts`) following the E-Mail-Anatomie, shared Resend transport in `core/mail/transport.ts`, ledger `mail_log` for exactly-once sending, unsubscribe tokens that name their kind (statement, digest, reminders).

## Capabilities

### New Capabilities

- `brand-touchpoint-mails`: Which transactional and digest mails exist, who gets them, when, and how sending stays idempotent and opt-out-able.

### Modified Capabilities

- `monthly-statement-email`: transport and unsubscribe moved to `core/mail`; behaviour unchanged.

## Impact

- Additive migration `0024_mail_log_and_digest` (table `mail_log` with RLS, column `wg_members.notify_digest_email`).
- `vercel.json` gets a sixth cron entry. Same env as the statement mail (`RESEND_API_KEY`, `STATEMENT_EMAIL_FROM`).
- Mails use `after()` so requests do not wait for the provider.
