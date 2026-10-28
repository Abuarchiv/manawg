# Backup, restore and database roles

A ManaWG instance keeps its data in three places: the app tables, the accounts (Supabase Auth,
schema `auth`) and the uploaded images (Supabase Storage). A useful backup has all three. Every
backup holds personal data: encrypt it at rest, keep it on another machine, and delete old ones on
a schedule.

## Docker

### Back up

```sh
./docker/backup.sh
```

writes `backups/manawg-<UTC time>.tar.gz` while the stack runs. It contains

- `database.dump`: `pg_dump` of the schemas `public` (app), `auth` (accounts), `storage` (image
  metadata) and `drizzle` (migration ledger),
- `storage.tar`: the image files from the `storage-data` volume.

Keep your `.env` next to the backups: without it you can still restore, but a new `JWT_SECRET`
ends all sessions, so members sign in again, and a new `MEMBER_SESSION_SECRET` breaks the calendar
feed URLs and unsubscribe links that were already handed out.

A nightly backup with cron, keeping 14 days, with the files encrypted to a key that does not live
on the server:

```text
15 3 * * * cd /srv/manawg && ./docker/backup.sh && find backups -name 'manawg-*.tar.gz' -mtime +14 -delete
```

Copy `backups/` off the machine (for example with `rsync` or `restic`). An encrypted copy with
[age](https://age-encryption.org) or GPG:

```sh
age -r <your public key> -o manawg.tar.gz.age backups/manawg-20261028-031500.tar.gz
```

### Restore

```sh
./docker/restore.sh backups/manawg-20261028-031500.tar.gz
```

stops the app, replaces the four schemas and the image files with the archive and starts the stack
again; the `setup` service then applies any newer migrations. On a new machine, clone the
repository, copy your old `.env` into it, then run the restore. Without the old `.env`, run
`./docker/setup.sh` first: existing sessions end, members sign in again, and calendar feed URLs and
unsubscribe links stop working, but their accounts and data are there.

The script checks that the archive holds a readable dump before it changes anything, and stops with
an error otherwise. Restoring over a live instance replaces its current data, so run
`./docker/backup.sh` first.

Test a restore now and then: start a second copy on another machine or port and check that you can
sign in and see your WG and its pictures.

## Vercel and Supabase

### Back up

Supabase's free plan keeps no backups. Take your own with the
[Supabase CLI](https://supabase.com/docs/guides/cli) and store them outside Supabase:

```sh
supabase db dump --db-url "$DATABASE_MIGRATION_URL" -f schema.sql
supabase db dump --db-url "$DATABASE_MIGRATION_URL" --data-only -f data.sql
supabase db dump --db-url "$DATABASE_MIGRATION_URL" --role-only -f roles.sql
```

Image files in Storage are not part of the dump. Download the bucket separately, for example with
the S3-compatible access that Supabase Storage offers.

### Restore

1. Create a new Supabase project. Never restore over a project that still serves users.
2. Restore in order: `roles.sql`, `schema.sql`, then `data.sql` (with `psql`, as `postgres`).
3. Run `pnpm --filter @manawg/web db:check` against the new project. It verifies the schema,
   the migration ledger and the row level security setup.
4. Point `POSTGRES_URL` and the Supabase variables at the new project and redeploy.

Accounts live in Supabase's `auth` schema. Check that your data dump contains `auth.users`;
otherwise members cannot sign in after a restore.

## Database roles

| Role | Used by | Rights |
| --- | --- | --- |
| `postgres` | Migrations (`pnpm --filter @manawg/web db:migrate`, the Docker `setup` service) | Owns the schema |
| `manawg_app` | The running app (`POSTGRES_URL`) | Row access only: no DDL, no ownership, no access to `auth` or the migration ledger |

The Docker `setup` service creates `manawg_app` with the password from `MANAWG_APP_DB_PASSWORD`.
On Supabase, create it once per project as `postgres`, before the first migration:

```sql
create role manawg_app login bypassrls password '<long random password>';
```

[`0034_app_role_grants`](../apps/web/drizzle/0034_app_role_grants.sql) grants it row access and
default privileges for future tables. Where the role does not exist, that migration is a no-op and
the app has to connect as `postgres`, which works but gives a compromised server more rights than
it needs.
