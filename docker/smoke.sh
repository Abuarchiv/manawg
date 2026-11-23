#!/bin/sh
# End-to-end check of a running local instance (./docker/setup.sh, docker compose up -d) with the
# mailpit profile: health, sign-up with the confirmation mail, a WG, a private image upload, the
# cron routes, then backup and restore with the data checked again. CI runs it on every change to
# the image; run it locally before you change compose.yaml or docker/.
#
#   ./docker/smoke.sh                     the whole check
#   ./docker/smoke.sh password-contract   only the new-password contract (needs node 22.18+)
#
# The password contract signs up the same way, then chooses new passwords below and at the
# minimum, with emoji, through /api/auth/password against the running GoTrue image. Each answer
# must match the app's own rule (apps/web/src/core/auth/password-rules.ts), so a client that
# counts characters differently from this GoTrue version fails here.
#
# Creates a test account and WG in this instance and leaves a backup in backups/.
set -eu

cd "$(dirname "$0")/.."
mode=${1:-all}
case $mode in all | password-contract) ;; *) echo "usage: $0 [password-contract]" >&2; exit 2 ;; esac
for tool in curl jq openssl; do
	command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
get() { sed -n "s/^$1=//p" .env | tail -n 1; }
app=$(get APP_URL)
mailpit_port=$(get MAILPIT_PORT)
mailpit=http://localhost:${mailpit_port:-8025}
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

if [ "$mode" = password-contract ]; then
	command -v node >/dev/null || fail "node is required for the password contract."
	# The contract is about the GoTrue image compose.yaml names; a stack without it proves nothing.
	configured=$(docker compose config --format json | jq -r '.services.auth.image // empty')
	[ -n "$configured" ] || fail "compose.yaml has no auth service"
	case $configured in */gotrue:* | */auth:*) ;; *) fail "auth service is not GoTrue: $configured" ;; esac
	running=$(docker compose ps --status running --format '{{.Image}}' auth 2>/dev/null)
	[ -n "$running" ] || fail "GoTrue (auth service) is not running"
	[ "$running" = "$configured" ] || fail "GoTrue runs $running, compose.yaml names $configured"
fi

step "health"
i=0
# A healthy answer may be cached by a proxy; a unique query always reaches the app.
health() { curl -s "$app/api/health?t=$(date +%s)-$i"; }
until [ "$(health | jq -r .status 2>/dev/null)" = ok ]; do
	i=$((i + 1))
	[ "$i" -lt 60 ] || fail "/api/health is not ok: $(health)"
	sleep 2
done

step "sign-up and confirmation mail"
email="smoke-$(openssl rand -hex 4)@example.test"
password="Smoke-$(openssl rand -hex 12)!"
api POST /api/auth/sign-up \
	-d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"Smoke\",\"next\":\"/login\"}" \
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
# Confirming drops the password given at sign-up; the account chooses one on /auth/reset.
grep -qx "$app/auth/reset?choose=1" "$work/landing" || fail "confirmation ended at $(cat "$work/landing")"

if [ "$mode" = password-contract ]; then
	step "password contract with $configured"
	rules="$PWD/apps/web/src/core/auth/password-rules.ts"
	app_rule() {
		PASSWORD=$1 node --no-warnings --input-type=module -e '
			const { isNewPasswordTooShort } = await import(process.argv[1]);
			console.log(isNewPasswordTooShort(process.env.PASSWORD) ? "rejected" : "accepted");
		' "$rules"
	}
	session_usable() {
		[ "$(curl -sS -b "$1" -o /dev/null -w '%{http_code}' "$app/api/wg/mine")" = 200 ]
	}
	cases=0
	# label, expected outcome, password. Accepted ones are random, so the breach check never hits.
	choose() {
		label=$1 expected=$2 candidate=$3
		cases=$((cases + 1))
		rule=$(app_rule "$candidate") || fail "$label: cannot evaluate $rules"
		api POST /api/auth/password -d "$(jq -nc --arg p "$candidate" '{password: $p}')" \
			-w '\n%{http_code}' >"$work/password"
		status=$(tail -n 1 "$work/password")
		body=$(sed '$d' "$work/password")
		if [ "$status" = 200 ] && echo "$body" | jq -e '.ok == true' >/dev/null; then
			server=accepted
		elif [ "$status" = 422 ] && echo "$body" | jq -e '.error == "weak_password"' >/dev/null; then
			server=rejected
		else
			fail "$label: /api/auth/password answered $status $body"
		fi
		[ "$rule" = "$server" ] || fail "$label: the app's rule says $rule, GoTrue $configured says $server"
		[ "$server" = "$expected" ] || fail "$label: expected $expected, both say $server"
		session_usable "$jar" || fail "$label: session no longer usable after the answer"
		if [ "$server" = accepted ]; then
			# A fresh cookie jar: the new password alone has to open a session.
			curl -sS -c "$work/fresh" -X POST -H "Origin: $app" -H 'content-type: application/json' \
				-d "$(jq -nc --arg e "$email" --arg p "$candidate" '{email: $e, password: $p}')" \
				"$app/api/auth/sign-in" >"$work/sign-in.json"
			jq -e '.sessionEstablished == true' "$work/sign-in.json" >/dev/null ||
				fail "$label: sign-in with the new password: $(cat "$work/sign-in.json")"
			session_usable "$work/fresh" || fail "$label: no session after signing in"
			rm -f "$work/fresh"
		fi
		echo "ok   $server  $label"
	}
	random=$(openssl rand -hex 3)
	choose "7 ASCII characters" rejected "$(openssl rand -hex 4 | cut -c 1-7)"
	choose "4 emoji (8 UTF-16 units)" rejected "😀🔑🏠🧹"
	choose "7 code points with emoji (10 UTF-16 units)" rejected "abcd😀🔑🏠"
	choose "8 code points with emoji, retry after the rejections" accepted "${random}🔑🏠"
	emoji=$(node -e 'const { randomInt } = require("node:crypto");
		process.stdout.write(String.fromCodePoint(...Array.from({ length: 8 }, () => 0x1f300 + randomInt(0x300))));')
	choose "8 emoji, all surrogate pairs (16 UTF-16 units)" accepted "$emoji"
	[ "$cases" -eq 5 ] || fail "only $cases of 5 password cases ran"
	echo "OK: the app's new-password rule matches $configured"
	exit 0
fi
api POST /api/auth/password -d "{\"password\":\"$password\"}" | jq -e '.ok == true' >/dev/null || fail "choosing a password failed"

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
until [ "$(health | jq -r .status 2>/dev/null)" = ok ]; do
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
