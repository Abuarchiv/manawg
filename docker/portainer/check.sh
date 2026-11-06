#!/bin/bash
# Checks that docker/portainer/compose.yaml still matches the files it inlines and the stack it
# mirrors: the Caddyfile, the database init script, the image versions and the service list. CI runs
# it with the docker workflow; run it after you change compose.yaml, docker/Caddyfile or docker/db/.
#
#   ./docker/portainer/check.sh
set -eu

cd "$(dirname "$0")/../.."
for tool in docker jq; do
	command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# Dummy values for the required settings; `config` only renders the file.
export POSTGRES_PASSWORD=0123456789abcdef01234567 JWT_SECRET=0123456789abcdef0123456789abcdef \
	APP_URL=http://localhost SMTP_HOST=mailpit SMTP_ADMIN_EMAIL=noreply@example.com \
	MANAWG_APP_DB_PASSWORD=x ANON_KEY=x SERVICE_ROLE_KEY=x MEMBER_SESSION_SECRET=x CRON_SECRET=x
unset COMPOSE_FILE COMPOSE_PROFILES
docker compose -f docker/portainer/compose.yaml --profile mailpit config --format json >"$work/portainer.json"
docker compose -f compose.yaml --profile mailpit config --format json >"$work/main.json"

# `config` prints the escape $$ as written; the container gets a single $.
jq -j '.configs.caddyfile.content' "$work/portainer.json" | sed 's/\$\$/$/g' >"$work/Caddyfile"
cmp -s "$work/Caddyfile" docker/Caddyfile || fail "the inline Caddyfile differs from docker/Caddyfile"
jq -j '.configs.roles.content' "$work/portainer.json" | sed 's/\$\$/$/g' >"$work/roles.sql"
cmp -s "$work/roles.sql" docker/db/roles.sql || fail "the inline roles.sql differs from docker/db/roles.sql"

images() { jq -r '.services | to_entries[] | select(.key != "keys") | "\(.key) \(.value.image)"' "$1" | sort; }
[ "$(images "$work/portainer.json")" = "$(images "$work/main.json")" ] ||
	fail "service images differ from compose.yaml (< Portainer file, > compose.yaml): $(diff <(images "$work/portainer.json") <(images "$work/main.json") 2>&1 || true)"

# Same settings per service. The variant loads these from the `keys` service's files instead.
envs() {
	jq -S '.services | del(.keys) | map_values(.environment // {}
		| del(.ANON_KEY, .SERVICE_KEY, .SUPABASE_SERVICE_ROLE_KEY, .MANAWG_APP_DB_PASSWORD,
			.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, .POSTGRES_URL, .MEMBER_SESSION_SECRET, .CRON_SECRET))' "$1"
}
envs "$work/portainer.json" >"$work/portainer.env.json"
envs "$work/main.json" >"$work/main.env.json"
diff "$work/main.env.json" "$work/portainer.env.json" >"$work/env.diff" ||
	fail "service settings differ from compose.yaml (< compose.yaml, > portainer): $(cat "$work/env.diff")"

# No bind mounts and no build: Portainer cannot resolve relative host paths.
jq -e '[.services[] | (.volumes // [])[] | select(.type == "bind")] | length == 0' "$work/portainer.json" >/dev/null ||
	fail "compose.yaml for Portainer must not bind-mount host paths"
jq -e '[.services[] | select(.build != null)] | length == 0' "$work/portainer.json" >/dev/null ||
	fail "compose.yaml for Portainer must not build images"

# The wrapped commands must still start the image's own program.
grep -q 'CMD \["sh", "-c", "node scripts/selfhost/public-env.mjs && exec node server.js"\]' Dockerfile ||
	fail "the Dockerfile CMD changed: update the app command in docker/portainer/compose.yaml"

jq -e . portainer-template.json >/dev/null || fail "portainer-template.json is not valid JSON"
echo "OK: docker/portainer/compose.yaml matches the main stack"
