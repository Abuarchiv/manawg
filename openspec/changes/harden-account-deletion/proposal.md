## Why

PR #428 (`a23bca8ad7f03db75e5bc7dd985efc8872c12543`) can leave calendar bearer access active after account deletion, delete a WG after a concurrent join succeeds, and leave a newly created membership linked to an already deleted Auth user. These are security and irreversible data-integrity failures that must be resolved before integration.

## What Changes

- Persist a minimal account-deletion fence atomically with local cleanup, and reject subsequent account-to-WG creation, joining, and legacy claiming.
- Serialize WG membership changes and deletion with one consistent lock order; revalidate membership and authorization after acquiring locks.
- Revoke calendar and push credentials and prevent already authenticated requests from recreating them after cleanup.
- Resume incomplete Supabase Auth deletion through the existing maintenance cron; distinguish accepted/pending deletion from confirmed completion in the API and UI.
- Add deterministic transaction, failure-recovery, bearer-access, and UI tests while preserving shared WG history and balances.

## Capabilities

### New Capabilities

- `safe-account-deletion`: Account deletion, access revocation, membership concurrency, and durable completion across PostgreSQL and Supabase Auth.

### Modified Capabilities

None. There are no published specifications under `openspec/specs/` for this behavior.

## Impact

- Existing account deletion route and component; database schema, migration, and account/WG deletion helpers.
- WG creation, joining, claiming, member-status changes, and whole-WG deletion authorization.
- Calendar subscription mutations and public feed access; notification subscription/preference writes that can restore credentials.
- Existing maintenance cron and deletion-focused tests. No new package, service, queue, or scheduler is required.
- `DELETE /api/account` gains an explicit pending response (HTTP 202); HTTP 200 is reserved for confirmed Auth deletion. The current confirmation and history-retention choices remain in scope.

## Non-goals

No redesign of WG navigation, financial settlement, general authentication, analytics, object-storage retention, or unrelated mutation protocols. No production migration or deployment is performed by this planning change, and no blanket GDPR/App Store compliance claim follows from local tests.
