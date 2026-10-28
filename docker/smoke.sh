#!/bin/sh
# End-to-end check of a running local instance (./docker/setup.sh, docker compose up -d) with the
# mailpit profile: health, sign-up with the confirmation mail, a WG, a private image upload, the
# cron routes, then backup and restore with the data checked again. CI runs it on every change to
# the image; run it locally before you change compose.yaml or docker/.
#
#   ./docker/smoke.sh
#
# Creates a test account and WG in this instance and leaves a backup in backups/.
set -eu

cd "$(dirname "$0")/.."
for tool in curl jq openssl; do
	command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
get() { sed -n "s/^$1=//p" .env | tail -n 1; }
app=$(get APP_URL)
mailpit=http://localhost:8025
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
jar="$work/cookies"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo "== $*"; }
# Same-origin requests as the browser sends them; the middleware rejects writes without Origin.
api() {
	method=$1 path=$2
	shift 2
	curl -sS -b "$jar" -c "$jar" -X "$method" -H "Origin: $app" -H 'content-type: application/json' \
		"$@" "$app$path"
}

step "health"
i=0
until [ "$(curl -s "$app/api/health" | jq -r .status 2>/dev/null)" = ok ]; do
	i=$((i + 1))
	[ "$i" -lt 60 ] || fail "/api/health is not ok: $(curl -s "$app/api/health")"
	sleep 2
done

step "sign-up and confirmation mail"
email="smoke-$(openssl rand -hex 4)@example.test"
password="Smoke-$(openssl rand -hex 12)!"
api POST /api/auth/sign-up \
	-d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"Smoke\",\"next\":\"/neu\"}" \
	>"$work/signup.json"
jq -e '.sessionEstablished == false' "$work/signup.json" >/dev/null ||
	fail "sign-up: $(cat "$work/signup.json")"
i=0
while :; do
	id=$(curl -s "$mailpit/api/v1/search?query=to:$email" | jq -r '.messages[0].ID // empty')
	[ -n "$id" ] && break
	i=$((i + 1))
	[ "$i" -lt 30 ] || fail "no confirmation mail for $email in Mailpit"
	sleep 1
done
link=$(curl -s "$mailpit/api/v1/message/$id" | jq -r .Text | grep -o "$app/auth/v1/verify?[^ ]*" | head -n 1)
[ -n "$link" ] || fail "confirmation mail without a link"
curl -sS -L -b "$jar" -c "$jar" -o /dev/null -w '%{url_effective}' "$link" >"$work/landing"
grep -qx "$app/neu" "$work/landing" || fail "confirmation ended at $(cat "$work/landing")"

step "WG"
api POST /api/wg -d '{"name":"Smoke WG","creatorName":"Smoke"}' >"$work/wg.json"
code=$(jq -r '.shareCode // .wg.shareCode // empty' "$work/wg.json")
[ -n "$code" ] || fail "WG not created: $(cat "$work/wg.json")"

step "private image upload"
printf '\211PNG\r\n\032\n' >"$work/receipt.png"
size=$(wc -c <"$work/receipt.png" | tr -d ' ')
api POST /api/upload/sign \
	-d "{\"shareCode\":\"$code\",\"purpose\":\"expense\",\"mimeType\":\"image/png\",\"fileSize\":$size}" \
	>"$work/sign.json"
upload=$(jq -r '.presignedUrl // empty' "$work/sign.json")
image=$(jq -r '.publicUrl // empty' "$work/sign.json")
[ -n "$upload" ] || fail "upload not signed: $(cat "$work/sign.json")"
status=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: image/png' \
	--data-binary "@$work/receipt.png" "$upload")
[ "$status" = 200 ] || fail "upload answered $status"
status=$(curl -sS -b "$jar" -o /dev/null -w '%{http_code}' "$image")
[ "$status" = 200 ] || fail "image read answered $status"
status=$(curl -sS -o /dev/null -w '%{http_code}' "$image")
[ "$status" = 401 ] || fail "image read without a session answered $status"

step "cron routes"
secret=$(get CRON_SECRET)
for route in $(jq -r '.crons[].path' apps/web/vercel.json); do
	status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $secret" "$app$route")
	[ "$status" = 200 ] || fail "$route answered $status"
done

step "backup and restore"
./docker/backup.sh >"$work/backup.log"
archive=$(tail -n 1 "$work/backup.log")
[ -f "$archive" ] || fail "no backup archive: $(cat "$work/backup.log")"
./docker/restore.sh "$archive" >"$work/restore.log" 2>&1 || fail "restore: $(tail -n 5 "$work/restore.log")"
i=0
until [ "$(curl -s "$app/api/health" | jq -r .status 2>/dev/null)" = ok ]; do
	i=$((i + 1))
	[ "$i" -lt 60 ] || fail "instance not healthy after restore"
	sleep 2
done
api POST /api/auth/sign-in -d "{\"email\":\"$email\",\"password\":\"$password\"}" >/dev/null
api GET /api/wg/mine | jq -e --arg code "$code" '.. | strings | select(. == $code)' >/dev/null ||
	fail "WG $code missing after restore"
status=$(curl -sS -b "$jar" -o /dev/null -w '%{http_code}' "$image")
[ "$status" = 200 ] || fail "image read after restore answered $status"

echo "OK: $app works end to end"
