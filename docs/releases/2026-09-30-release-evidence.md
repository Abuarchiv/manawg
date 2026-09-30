# Release evidence — 2026-09-30

This is dated evidence, not unconditional release approval. CI work is deferred
at the owner's explicit request. No Production migration was performed.

## Confirmed Production application

- `app.manawg.com` resolves to READY deployment
  `dpl_37GfugtVpdpbuXJMKyPvvSuyQEyV`, source
  `6aa0b666bb4704138e6976629716f8a9eac19c07`.
- Health returned 200, database OK, zero missing required configuration and no
  degraded features. The dedicated Production test account could log in and
  read its own WG. Anonymous and foreign-WG reads returned 401.
- The integrated runtime passed 393 unit/route checks (one skip), 512 Chromium
  fixture cases (43 explicit skips), lint, typecheck, build and bundle budget.
  These are local results, not hosted Preview or real-device acceptance.
- The isolated Pinnwand route fixture now blocks service workers and updates
  its in-memory comments after deletion. All five cases passed in Chromium and
  WebKit; the focused comment case independently passed three times in each.

## Database and private storage

- Production readback found 18 migrations through `0017`, 28 public tables,
  RLS on every public table, and no direct anon/authenticated table grants.
- A fresh isolated sole-member test WG completed private upload and readback:
  7,786 bytes, identical SHA-256 to the uploaded icon, private/no-store response.
  Anonymous read returned 401. Expense deletion revoked the copied image URL
  with 404 before membership removal; the test WG was then removed. Existing
  test WG data was untouched. Provider object cleanup remains pending normal
  maintenance; the tombstone is intentionally retained.

## Recovery and accompanying services

- The fresh Production export at `2026-09-30T11:46:29Z` restored in isolated
  Supabase PostgreSQL 17.6 with all 62 COPY section counts matching. Temporary
  restore resources were removed. The encrypted AES-256/OCB bundle decrypted
  successfully and all five member hashes matched. Storage inventory was empty
  at snapshot time; this does not prove restoration of later object bytes.
- OrbStack login startup is enabled. The backup script checks only its local
  context and bounds daemon readiness to 60 seconds; Stopped fails immediately.
  A future login startup race remains possible. Offsite storage, separate key
  custody and hosted restore/PITR remain unproven.
- ManaWG MCP `e7406872` passed 154 tests, lint, types, build and smoke; an
  independent 87-test run passed. Installed dist was rebuilt. No running MCP
  process was found, so no restart was performed.
- Landing `47d0ff76` is deployed to `manawg.com`. The current privacy page was
  fetched with verified TLS/SNI/Host through the reachable Vercel endpoint.
  Sentry disclosures are conditional; Upstash historical retention is explicit.

## Remaining acceptance boundaries

- The existing PayPal Sandbox credentials and seller readiness work (OAuth and
  readiness HTTP 200). One EUR 0.01 order exists in CREATED state. Buyer
  approval, capture and WG settlement are not proven. No new Sandbox setup or
  Production credential change is required by this evidence.
- Hosted Preview authenticated multi-user acceptance remains unproven: local
  SSR accepted Preview cookies, but the protected hosted route returned 401.
  Investigate build-time target and cookie transport without weakening auth.
- Historical Upstash metadata scan found 552 persistent ZSET keys containing
  1,111 entries. No event payloads were read. Deletion requires specific owner
  confirmation; no deletion or TTL change has occurred.
  The guarded helper passed independent review, 17 Node 22 mock checks and
  eight real Lua scenarios against isolated official Redis (network none,
  tmpfs, no host mounts). Guard failures preserved all supplied keys. Temporary
  resources were removed. Execution remains disabled without the exact
  confirmation literal and unchanged metadata fingerprint.
- Real iOS/Android push, install and offline acceptance, offsite recovery and
  alert-mail receipt are not proven. Absence of a matching inbox search result
  is not proof that an alert was never delivered.
