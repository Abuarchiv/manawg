## Decisions

- One ledger for all mails that may be sent once (`mail_log.dedupe_key` unique): `welcome:<authUserId>`, `invite:<wgId>:<sha256(email)>:<day>`, `reminder:<reminderId>`, `digest:<memberId>:<day>`, `account-deleted:<authUserId>`. A row is claimed as `sending` before the provider call; `failed` rows are claimable again, `sent`/`sending` rows are not.
- Addresses are never persisted. The invitation key keeps a truncated hash so one address gets one mail per WG and day.
- E7 and E8 are the mail stand-ins for push: they go only to members with `push_opt_in = false`. Push users keep push only, so nobody is told twice.
- Unsubscribe tokens: statements keep the two-part format already in sent mails; digest and reminder tokens carry their kind (`<memberId>.<kind>.<hmac>`) and a kind cannot be swapped without re-signing.
- `after()` from `next/server` runs the provider call after the response; outside a request scope (tests) the task runs inline (`core/infra/after-response.ts`).
- Honest copy where the product differs from the mock-up: the share code does not expire ("gilt, solange die WG Beitritte erlaubt"); the digest says it comes only when something happened.

## Not done

- E7 as a replacement for push *per category* when a user disables one push category: the digest follows the per-area switches but is only sent to members without push at all.
- Welcome mail for accounts older than 24 h at first sign-in (edge: confirmation long after sign-up) is skipped on purpose.
