#!/bin/sh
# Backs up a running Docker instance into backups/manawg-<UTC time>.tar.gz:
# database.dump (pg_dump of the app, Auth and Storage schemas) and storage.tar (uploaded images).
# Keep copies somewhere else; the archive holds personal data, treat it like a password.
#
#   ./docker/backup.sh
set -eu

cd "$(dirname "$0")/.."
stamp=$(date -u +%Y%m%d-%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p backups

docker compose exec -T db pg_dump -U supabase_admin -d postgres -Fc \
	--schema=public --schema=auth --schema=storage --schema=drizzle >"$work/database.dump"
docker compose exec -T storage tar -cf - -C /var/lib/storage . >"$work/storage.tar"

umask 077
tar -czf "backups/manawg-$stamp.tar.gz" -C "$work" database.dump storage.tar
echo "backups/manawg-$stamp.tar.gz"
