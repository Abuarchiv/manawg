## Decisions

**When.** Vercel cron daily at 07:00 UTC (08:00/09:00 Berlin). The handler acts only on Berlin days 1–5 of a month: day 1 sends, days 2–5 retry rows still `failed` or never claimed. Day 1 instead of "last day of the month" because expenses booked late on the 31st must be in; the design copy says "am ersten Werktag" — we use the 1st regardless of weekday so the date is predictable ("Einmal im Monat, am Ersten").

**Recipients.** Per WG, every member who
1. is active (`deactivated_at IS NULL`),
2. has an Auth account (`auth_user_id` set) with a confirmed e-mail (`auth.users.email_confirmed_at`, read through the Supabase admin API with the service-role key),
3. has `notify_statement_email = true`,
4. took part in the month (paid or owes a share > 0),
and the WG has at least two participants in that month. Everything else is skipped and recorded as `skipped:<reason>` in the ledger so the run is explainable. A member whose Auth address lookup failed (timeout, 429, 5xx) is neither mailed nor recorded, so a later run decides; `no_email` is written only when Auth answered and the user has no confirmed address. Missing service-role configuration throws.

**Content (E9).** Subject `<Monat> ist abgerechnet` (e.g. "September ist abgerechnet"), preheader "<n> Personen, <k> Ausgaben, <Status>." Eyebrow `<WG-Name> · SEPTEMBER 2026`, three tiles Gesamt / Ausgaben / Dein Anteil (mono), status line:
- all shares settled → green "Alles ausgeglichen  0,00 €"
- member is owed → green "Du bekommst  +x €"
- member owes → red "Du schuldest  x €" plus the transfers that involve this member ("an Jonas 23,40 €").
One black button "Abrechnung ansehen" → `https://app.manawg.com/wg/<code>/abrechnung?monat=YYYY-MM`. Footer: "Einmal im Monat, am Ersten. Als PDF in der App." + "Einstellungen ändern · Abbestellen". No expense list and no PDF attachment: the mail is a snapshot, the app page is the truth.

**Idempotency.** `statement_emails(id, wg_id, member_id, month_key, status, provider_id, error, attempts, created_at, sent_at)`, unique `(member_id, month_key)`. A run inserts `pending` rows with `ON CONFLICT DO NOTHING` (a `skipped` row whose member qualifies later is switched back to `pending`), claims rows with `FOR UPDATE SKIP LOCKED` and commits them as `sending` (attempt count +1, `claimed_at`) before anything is sent. The result (`sent`/`failed`/`skipped`, or `pending` again when the provider deferred) is written afterwards in one short transaction, tried twice. No transaction stays open across the provider call. Resend's `Idempotency-Key` header is a hash of the batch's ledger row ids and their attempt counts. A row still `sending` after 15 minutes means the run died or could not record the result: the mail may have gone out, so the row is closed as `failed` with `attempts = 5` and `interrupted_unconfirmed` and is never resent. A request timeout is closed the same way (`unconfirmed`); other failures are retried with a fresh key on the next day. A missing statement is cheaper than a duplicate.

**Throughput.** Resend free plan: 100 mails/day, 3 000/month, 2 requests/s. The batch endpoint (`POST /emails/batch`, ≤100 per call) keeps the request count low. When a day's quota is exhausted (HTTP 429 / daily_quota_exceeded) the run stops and days 2–5 continue. Above ~100 recipients the plan must be upgraded; the run logs one warning line when rows failed, were left unconfirmed or the quota was reached.

**Unsubscribe.** Link `https://app.manawg.com/api/email/unsubscribe?t=<token>`; token = base64url(memberId.monthKey) + HMAC-SHA256 with `MEMBER_SESSION_SECRET`. GET shows a confirm page, POST (one-click, RFC 8058) sets `notify_statement_email = false` for every membership of the same Auth account (the List-Unsubscribe header reads as a global opt-out). Works without login.

**Environments.** Only `VERCEL_ENV=production` sends, and production without `RESEND_API_KEY` throws. Preview/local run the same code with a dry-run transport that logs a masked address and the mail size and writes no ledger row, so the cron can be exercised end-to-end without mail. An optional `STATEMENT_EMAIL_ALLOWLIST` (comma-separated addresses) restricts recipients and also enables real sending outside production, for Preview tests; recipients outside the list get no ledger row.

## Rejected

- Supabase SMTP for product mail: only reachable from Auth flows.
- Sending at 23:59 on the last day: misses late entries and Vercel cron timing is only hourly-accurate on Hobby.
- One combined mail for members in several WGs: subject and link would have to cover several WGs; per-WG mail is clearer and rare in practice.
- PDF attachment: needs a headless browser in a function; the print view in the app covers it.
