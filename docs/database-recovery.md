# Database roles and recovery

## Roles

| Role | Used by | Rights |
| --- | --- | --- |
| `postgres` | Migrations (`pnpm --filter @manawg/web db:migrate`) | Owns the schema |
| `manawg_app` | The running app (`POSTGRES_URL`) | Row access only: no DDL, no ownership, no access to `auth` or the migration ledger |

Create `manawg_app` once per project as `postgres`, before the first migration:

```sql
create role manawg_app login bypassrls password '<long random password>';
```

[`0034_app_role_grants`](../apps/web/drizzle/0034_app_role_grants.sql) grants it row access and
default privileges for future tables. Where the role does not exist, that migration is a no-op and
the app has to connect as `postgres`, which works but gives a compromised server more rights than
it needs.

## Backups

Supabase's free plan keeps no backups. Take your own and store them outside Supabase:

```sh
supabase db dump --db-url "$DATABASE_MIGRATION_URL" -f schema.sql
supabase db dump --db-url "$DATABASE_MIGRATION_URL" --data-only -f data.sql
supabase db dump --db-url "$DATABASE_MIGRATION_URL" --role-only -f roles.sql
```

The dumps contain personal data. Encrypt them at rest and delete old ones on a schedule.

## Restore

1. Create a new Supabase project. Never restore over a project that still serves users.
2. Restore in order: `roles.sql`, `schema.sql`, then `data.sql` (with `psql`, as `postgres`).
3. Run `pnpm --filter @manawg/web db:check` against the new project. It verifies the schema,
   the migration ledger and the row level security setup.
4. Point `POSTGRES_URL` and the Supabase variables at the new project and redeploy.

Accounts live in Supabase's `auth` schema. Check that your data dump contains `auth.users`;
otherwise members cannot sign in after a restore. Image files in Storage need their own
backup.
