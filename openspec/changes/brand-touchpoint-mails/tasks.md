## 1. Foundation

- [x] 1.1 Move the Resend transport to `core/mail/transport.ts` with a configurable idempotency prefix and optional unsubscribe header; statement module re-exports.
- [x] 1.2 Schema + migration 0024: `mail_log` (unique dedupe key, RLS on, no Data API grants), `wg_members.notify_digest_email`.
- [x] 1.3 `core/mail/brand-mail.ts` shell per E-Mail-Anatomie; `send-mail.ts` ledger claim → send → outcome.
- [x] 1.4 Unsubscribe tokens with kind (statement compatible), route copy per kind.

## 2. Mails

- [x] 2.1 E1 welcome in the auth callback for accounts younger than 24 h.
- [x] 2.2 E6 invitation route + `InviteByMailForm` under the share card; rate limiter `invite-mail`; audit event without the address.
- [x] 2.3 E7 digest job `core/mail/daily-digest.ts`, cron route and `vercel.json` entry (06:30 UTC); settings toggle "Tageszusammenfassung per E-Mail".
- [x] 2.4 E8 reminder mail from the reminders route for debtors without push.
- [x] 2.5 E10 account-deleted mail from the account route and the maintenance retry.

## 3. Verification

- [x] 3.1 Unit tests: templates (no exclamation marks, escaping, links), unsubscribe kinds; full suite green.
- [x] 3.2 E2E: settings-preferences, settings-access, notifications, settlement-debts, account-delete-ui on the fixture build (39 passed, 2026-10-10).
- [x] 3.3 Prod migration 0024 applied 2026-10-10 (ledger 25) and deployed (dpl_5pySr87RYz9LD4xmJq7bddmSxP3c). First real mails still need `RESEND_API_KEY` in Vercel Production; until then every send is logged as an error in the function logs.
