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

A nightly backup with cron, keeping 14 days:

```text
15 3 * * * cd /srv/manawg && ./docker/backup.sh && find backups -name 'manawg-*.tar.gz' -mtime +14 -delete
```

The archives above are not encrypted. Store them on an encrypted volume and copy them off the
machine. To encrypt a copy with [age](https://age-encryption.org), use a public recipient key
and keep its private key off the server:

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
sign in and see your flat and its pictures.

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

### Restore the encrypted nightly backup

The **Database nightly** workflow (`.github/workflows/database-nightly.yml`, also started by
hand) keeps an artifact `production-database-<run id>` for 90 days. It holds one file,
`manawg-<UTC time>.tar.gpg`, encrypted for the backup key (`BACKUP_GPG_PUBLIC_KEY`). Inside:

- `database.dump`: `pg_dump --format=custom` of `public`, `drizzle`, `auth` and `storage`,
  without owners and privileges,
- `storage/<bucket>/<object>`: every Storage object listed in `storage.objects`.

The backup job only proves that the file decrypts to the same archive. Prove the restore
yourself, on a machine with the private key, into a database that serves nobody:

```sh
umask 077
gh run download <run id> --repo Abuarchiv/manawg --dir backup
gpg --decrypt backup/*/manawg-*.tar.gpg | tar -x    # database.dump, storage/
pg_restore --list database.dump | grep -c 'TABLE DATA'
```

Into a disposable PostgreSQL 17 (for example `docker run --network none postgres:17`), create
what the dump expects but does not contain, then restore:

```sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role manawg_app login bypassrls password '<long random password>';
create schema extensions;
create extension pgcrypto schema extensions;
create extension "uuid-ossp" schema extensions;
create schema auth;
create schema storage;
create schema drizzle;
```

```sh
pg_restore --no-owner --no-privileges --schema=public --schema=drizzle --schema=auth \
  --schema=storage --dbname=<disposable url> database.dump
```

The restore must finish without `ERROR` lines. The dump carries no privileges, so put them back:
functions get PostgreSQL's default `EXECUTE` for `PUBLIC`, and `manawg_app` has no table rights.
The migration ledger already lists `0034_app_role_grants`, so the migration runner does not grant
them again; run that file by hand:

```sh
psql <disposable url> -c 'revoke execute on all functions in schema public from public, anon, authenticated'
psql <disposable url> -v ON_ERROR_STOP=1 -f apps/web/drizzle/0034_app_role_grants.sql
psql <disposable url> -Atc "select has_table_privilege('manawg_app', 'public.wgs', 'SELECT')"  # t
```

The restored database is at the migration level of the backup. Check it with the version that
will run on it, from a checkout of that version's commit:

```sh
git checkout <SHA that will run on it>
MANAWG_SELF_HOSTED=true DATABASE_MIGRATION_URL=<disposable url> pnpm --filter @manawg/web db:check
```

`db:check` compares the schema with that version's newest snapshot and fails on any table,
column or constraint the version does not know, so it also tells you when the backup is newer
than the version. Run `db:migrate` instead of `db:check` only when you restore to move forward
and want the newer migrations applied.

Check that the counts of `public.wgs`, `public.wg_members`, `auth.users` and `storage.objects`
match the source, that `storage.objects` has as many rows as `storage/` has files, and that the
app role can read: `psql` as `manawg_app` and count `public.wgs`.

#### Into an initialized Supabase database

A new Supabase project, or the `db` service of the Docker stack, already has the `auth` and
`storage` schemas with their tables, roles and migration ledgers, so the empty-database restore
above fails there (`relation "auth.users" already exists`). Restore the app schemas whole and only
the rows of `auth` and `storage`. Never do this on a project that still serves users.

Connect as `postgres`, which on Supabase is not a superuser and does not own the Auth and Storage
tables: it cannot disable their triggers (`pg_restore --disable-triggers` fails with
`must be owner of table users`) and may only read a few Storage tables. Instead the rows go in
with `session_replication_role = replica`, which `postgres` may set and which skips triggers and
foreign key checks. Stop Auth and Storage first (Docker: `docker compose stop auth storage`).

Run the script below with `sh` (not as lines pasted into zsh), with `PGHOST`, `PGPORT`,
`PGUSER=postgres`, `PGPASSWORD` and `PGDATABASE` set for the target, in the directory with
`database.dump`. It stops at the first error. It reads the whole dump and writes the Auth and
Storage input to files before it changes anything, so a missing or damaged dump changes nothing.
The Auth and Storage rows then load in one transaction: every Auth and Storage table except the
two migration ledgers is emptied, also when the backup has no rows for it, and a table `postgres`
cannot empty must already be empty, or the transaction stops with nothing changed.

```sh
set -eu
[ -s database.dump ]
pg_restore -f /dev/null database.dump    # reads the whole dump: fails on a damaged one
# Rows of Auth and Storage without their migration ledgers. Empty COPY blocks are dropped,
# because postgres may not write to every Storage table, even nothing.
pg_restore -l database.dump > toc.list
awk '$4 == "TABLE" && $5 == "DATA" && ($6 == "auth" || $6 == "storage") &&
  $7 != "schema_migrations" && $7 != "migrations"' toc.list > auth-storage.list
[ -s auth-storage.list ]
pg_restore --data-only -L auth-storage.list -f auth-storage-all.sql database.dump
awk '/^COPY / {head = $0; rows = ""; n = 0; copy = 1; next}
  copy && $0 == "\\." {if (n) printf "%s\n%s\\.\n", head, rows; copy = 0; next}
  copy {rows = rows $0 "\n"; n++; next}
  {print}' auth-storage-all.sql > auth-storage.sql
grep -q '^COPY auth.users ' auth-storage.sql

# Only now change the target.
psql -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'manawg_app') then
    create role manawg_app login bypassrls password '<long random password>';
  end if;
end $$;
set client_min_messages = warning;
drop schema if exists drizzle cascade;
drop schema public cascade;
create schema public;
create schema drizzle;
grant usage on schema public to anon, authenticated, service_role;
SQL
pg_restore --no-owner --no-privileges --schema=public --schema=drizzle --exit-on-error \
  --dbname="$PGDATABASE" database.dump

cat > auth-storage-empty.sql <<'SQL'
set session_replication_role = replica;
do $$ declare r record; has_rows boolean; begin
  for r in select schemaname, tablename from pg_tables
    where schemaname in ('auth', 'storage') and tablename not in ('schema_migrations', 'migrations')
  loop
    if has_table_privilege(format('%I.%I', r.schemaname, r.tablename), 'DELETE') then
      execute format('delete from %I.%I', r.schemaname, r.tablename);
    else
      execute format('select exists (select from %I.%I)', r.schemaname, r.tablename) into has_rows;
      if has_rows then
        raise exception '%.% has rows that postgres cannot delete', r.schemaname, r.tablename;
      end if;
    end if;
  end loop;
end $$;
SQL
psql -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null \
  -f auth-storage-empty.sql -f auth-storage.sql
```

Then put the privileges back, run `db:check` and the counts as above, and start Auth and Storage
again. The backup's Auth and Storage rows must fit the target's Auth and Storage versions; use the
versions of the backed-up instance. Delete `auth-storage*.sql` with the other decrypted files.

This path is rehearsed on the Docker stack's `supabase/postgres` image as the non-superuser
`postgres` role. On a hosted project, first check that `postgres` may run
`set session_replication_role = replica`; if it may not, restore the Auth and Storage rows with
Supabase support instead of working around it.

Upload each `storage/<bucket>/<object>` to the same bucket and path with the service key
(`POST /storage/v1/object/<bucket>/<object>` with `x-upsert: true`), and read one back to compare
the bytes. Then point the app's database and Supabase variables at the new database and deploy
the version you checked. Writes made after the backup are lost. Delete the decrypted files when
you are done.

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
