#!/bin/sh
# Restores an archive from docker/backup.sh into this instance, replacing its data:
#
#   ./docker/restore.sh backups/manawg-20261028-101500.tar.gz
#
# Works on a fresh stack too (after ./docker/setup.sh): it starts the database on its own first.
# Sessions end when JWT_SECRET differs from the backed-up instance; members sign in again.
set -eu

archive="${1:?usage: ./docker/restore.sh <backup.tar.gz>}"
[ -f "$archive" ] || { echo "No such file: $archive" >&2; exit 1; }
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work"

docker compose stop app cron gateway auth storage >/dev/null 2>&1 || true
docker compose up -d --wait db

# The dump grants rights to the runtime role; the setup service sets its password afterwards.
docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qc \
	"do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'manawg_app') then create role manawg_app; end if; end \$\$"
docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qc \
	"drop schema if exists drizzle cascade; drop schema if exists public cascade; drop schema if exists storage cascade; drop schema if exists auth cascade;"
docker compose exec -T db pg_restore -U supabase_admin -d postgres --exit-on-error <"$work/database.dump"

docker compose run --rm --no-deps -T --entrypoint sh storage \
	-c 'rm -rf /var/lib/storage/* && tar -xf - -C /var/lib/storage' <"$work/storage.tar"

docker compose up -d
echo "Restored $archive"
