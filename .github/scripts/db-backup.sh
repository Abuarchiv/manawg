#!/usr/bin/env bash
# Backs up the database described by PG_ENV_FILE (libpq variables) and, when SUPABASE_URL and
# STORAGE_KEY_FILE are given, every Storage object, as one tar encrypted for the backup key. With the
# private key given, it proves that the encrypted file decrypts to the same tar. Only the encrypted
# file stays in WORK_DIR; its path is printed on stdout.
#
# Restore into a disposable project first:
#   gpg --decrypt manawg-<time>.tar.gpg | tar -x    # database.dump, storage/<bucket>/<object>
#   psql <url> -c 'create schema drizzle'
#   pg_restore --no-owner --no-privileges --schema=public --schema=drizzle --dbname=<url> database.dump
# The passphrase is in the operator's Keychain (service "ManaWG Backup GPG passphrase").
set -euo pipefail

: "${PG_ENV_FILE:?}" "${WORK_DIR:?}" "${PUBLIC_KEY_FILE:?}"
IMAGE='postgres:17@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
RECIPIENT='326F1F1B3A8D3193C524DF875F55F8BE82C4D50F'

name="manawg-$(date -u +%Y-%m-%dT%H%M%SZ)"
stage="$WORK_DIR/$name"
export GNUPGHOME
GNUPGHOME="$(mktemp -d)"
# Plaintext never outlives the script, also when a check fails.
trap 'rm -rf "$GNUPGHOME" "$stage" "$stage.tar" "$stage.check"' EXIT
mkdir -p "$stage/storage"

pg() {
	docker run --rm --user "$(id -u):$(id -g)" --env-file "$PG_ENV_FILE" -v "$WORK_DIR:/work" "$IMAGE" "$@"
}

pg pg_dump --format=custom --no-owner --no-privileges \
	--schema=public --schema=drizzle --schema=auth --schema=storage \
	--file="/work/$name/database.dump" >&2
toc="$(pg pg_restore --list "/work/$name/database.dump")"
for required in 'TABLE DATA public wgs' 'TABLE DATA public wg_members' 'TABLE DATA auth users' \
	'TABLE DATA drizzle __drizzle_migrations'; do
	grep -q "$required" <<<"$toc" || {
		echo "Backup is missing: $required" >&2
		exit 1
	}
done

if [ -n "${STORAGE_KEY_FILE:-}" ]; then
	: "${SUPABASE_URL:?}"
	# The database lists every object, so nothing depends on paging through the Storage API.
	objects="$(pg psql -X -At -F $'\t' -c 'select bucket_id, name from storage.objects order by 1, 2')"
	expected=0
	while IFS=$'\t' read -r bucket object; do
		[ -n "$bucket" ] || continue
		case "/$bucket/$object/" in
		*/../* | */./* | *//*)
			echo "Unsafe Storage path: $bucket/$object" >&2
			exit 1
			;;
		esac
		path="$(jq -rn --arg b "$bucket" --arg o "$object" '[$b] + ($o | split("/")) | map(@uri) | join("/")')"
		mkdir -p "$(dirname "$stage/storage/$bucket/$object")"
		curl -fsS --retry 3 -H "apikey: $(cat "$STORAGE_KEY_FILE")" \
			-o "$stage/storage/$bucket/$object" "$SUPABASE_URL/storage/v1/object/authenticated/$path"
		expected=$((expected + 1))
	done <<<"$objects"
	stored="$(find "$stage/storage" -type f | wc -l)"
	[ "$stored" -eq "$expected" ] || {
		echo "Storage backup has $stored of $expected objects." >&2
		exit 1
	}
	echo "Storage objects: $stored" >&2
fi

tar -cf "$stage.tar" -C "$stage" database.dump storage
gpg --batch --quiet --import "$PUBLIC_KEY_FILE"
gpg --batch --quiet --trust-model always --encrypt --recipient "$RECIPIENT" \
	--output "$stage.tar.gpg" "$stage.tar"

if [ -n "${PRIVATE_KEY_FILE:-}" ]; then
	: "${PASSPHRASE_FILE:?}"
	gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
		--import "$PRIVATE_KEY_FILE"
	gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
		--decrypt --output "$stage.check" "$stage.tar.gpg"
	cmp -s "$stage.tar" "$stage.check" || {
		echo 'Decrypted backup differs from the archive.' >&2
		exit 1
	}
fi

echo "$stage.tar.gpg"
