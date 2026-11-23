# Database advisor review

Review of the Supabase database advisors (security and performance, level INFO) for the hosted
production database on 2026-11-23. It records why the reported findings are accepted, so a later
advisor run can be compared against it. Re-run with:

```sh
supabase db advisors --linked --type all --level info
```

## `rls_enabled_no_policy` (31 tables): intended

Every table in `public` has row level security enabled and no policy. This is the access model, not a
gap:

- The app never uses the Supabase Data API (PostgREST) for application data. Route handlers and
  cron jobs read and write through their own server connection (Drizzle on `pg`, see
  [Architecture → Database](architecture.md#database)). The Supabase client is used for Auth and
  Storage only, never for tables.
- `anon` and `authenticated` hold no table, sequence or function privileges in `public`
  (`0007_data_api_security.sql`, `0016`), and they cannot create objects there. RLS without a policy
  denies every row on top of that, so a forgotten `GRANT` still exposes nothing.
- Adding a policy would open a second access path that bypasses the server-side membership and
  idempotency checks. Do not add one unless the Data API becomes a deliberate client interface.

Checked on the production catalog: 31 of 31 tables with RLS, 0 policies, 0 effective privileges for
`anon` and `authenticated`. `pnpm db:check` (`scripts/db-migrate/catalog-security.mjs`) enforces the
same rules after every migration, and `tests/data-api-access-db.test.ts` runs `SELECT` and `DELETE`
on every table as both roles and expects permission denied.

The advisor will keep reporting these 31 findings. They are expected.

## `unused_index` (27 indexes): all retained

The usage counters had been collecting for about 90 days (statistics reset on 2026-08-25). The
tables are still small, so the planner prefers sequential scans for most queries and an
`idx_scan` of 0 says little about the indexes' value at scale. Dropping an index also needs a
migration, and a migration takes the gated release path. No index is removed now.

| Index | Why it stays |
| --- | --- |
| `announcement_comments_member_idx`, `announcement_reactions_member_idx`, `calendar_subscriptions_member_idx`, `expense_imports_imported_by_member_idx`, `expense_payments_from_member_idx`, `expense_payments_to_member_idx`, `expense_reminders_creditor_member_idx`, `expense_reminders_debtor_member_idx`, `expense_reminders_sent_by_member_idx`, `recurring_expenses_created_by_member_idx`, `recurring_expenses_paid_by_member_idx`, `shopping_items_added_by_idx`, `shopping_items_bought_by_member_idx`, `wg_chat_reactions_member_idx`, `wg_events_created_by_member_idx`, `wg_inventory_log_member_idx` | Covers a foreign key to `wg_members`. Deleting a member or an account (cascade, set null, restrict checks) would otherwise scan the child table. |
| `expenses_import_idx` | Covers `expenses.import_id`; undoing an import deletes `expense_imports`, which checks this key. |
| `wg_chat_reads_last_read_idx` | Covers the foreign key to `wg_chat_messages`, checked when chat messages are deleted. |
| `push_subscriptions_endpoint_lookup_idx` | Lookups and deletes by `endpoint` alone (`notification-writes.ts`); the unique `(member_id, endpoint)` index cannot serve them. |
| `recurring_expenses_next_due_idx` | Cron scan of due, unpaused templates (`cron/recurring-advance`). |
| `announcements_pinned_idx` | Pinned posts per WG on the board. The planner currently picks `announcements_status_idx`; keep until the board query is measured at scale. |
| `wg_members_auth_user_idx` | Account lookups by `auth_user_id` across WGs (account deletion, mail opt-out, onboarding mail). |

### Candidates for a later cleanup

Local query plans (with sequential scans disabled) show these indexes are shadowed by a wider
index and no query needs them. Drop them together with the next schema migration that touches these
tables, then re-run the advisors:

- `wg_events_wg_idx (wg_id)`: `wg_events_wg_starts_idx (wg_id, starts_at)` serves every lookup and
  the foreign key.
- `wg_inventory_items_wg_idx (wg_id)`: covered by `wg_inventory_items_recent_decrement_idx` and
  `wg_inventory_items_unique_name`.
- `wg_members_wg_idx (wg_id)`: covered by `wg_members_unique_name_per_wg (wg_id, name)`.
- `announcement_reactions_announcement_idx (announcement_id)`: covered by
  `announcement_reactions_unique_member_reaction (announcement_id, member_id, reaction)`, which also
  serves the foreign key to `announcements`.
- `expense_reminders_debtor_idx (wg_id, debtor_member_id, sent_at)`: the cooldown query filters by
  the full pair and uses `expense_reminders_pair_idx`; no query filters by debtor alone.
