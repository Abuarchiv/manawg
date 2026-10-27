#!/usr/bin/env bash
# Dumps the database described by PG_ENV_FILE (libpq variables), encrypts the dump for the backup
# key and, when the private key is given, proves that the encrypted file restores to the same dump.
# Only the encrypted file stays in WORK_DIR; its path is printed on stdout.
set -euo pipefail

: "${PG_ENV_FILE:?}" "${WORK_DIR:?}" "${PUBLIC_KEY_FILE:?}"
IMAGE='postgres:17@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
RECIPIENT='326F1F1B3A8D3193C524DF875F55F8BE82C4D50F'

name="manawg-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
export GNUPGHOME
GNUPGHOME="$(mktemp -d)"
# Plaintext never outlives the script, also when a check fails.
trap 'rm -rf "$GNUPGHOME" "$WORK_DIR/$name" "$WORK_DIR/$name.toc" "$WORK_DIR/$name.check"' EXIT

pg() {
	docker run --rm --user "$(id -u):$(id -g)" --env-file "$PG_ENV_FILE" -v "$WORK_DIR:/work" "$IMAGE" "$@"
}

pg pg_dump --format=custom --no-owner --no-privileges \
	--schema=public --schema=drizzle --schema=auth --schema=storage \
	--file="/work/$name" >&2
pg pg_restore --list "/work/$name" >"$WORK_DIR/$name.toc"
for required in 'TABLE DATA public wgs' 'TABLE DATA public wg_members' 'TABLE DATA auth users' \
	'TABLE DATA drizzle __drizzle_migrations'; do
	grep -q "$required" "$WORK_DIR/$name.toc" || {
		echo "Backup is missing: $required" >&2
		exit 1
	}
done

gpg --batch --quiet --import "$PUBLIC_KEY_FILE"
gpg --batch --quiet --trust-model always --encrypt --recipient "$RECIPIENT" \
	--output "$WORK_DIR/$name.gpg" "$WORK_DIR/$name"

if [ -n "${PRIVATE_KEY_FILE:-}" ]; then
	: "${PASSPHRASE_FILE:?}"
	gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
		--import "$PRIVATE_KEY_FILE"
	gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
		--decrypt --output "$WORK_DIR/$name.check" "$WORK_DIR/$name.gpg"
	cmp -s "$WORK_DIR/$name" "$WORK_DIR/$name.check" || {
		echo 'Decrypted backup differs from the dump.' >&2
		exit 1
	}
fi

echo "$WORK_DIR/$name.gpg"
