#!/bin/sh
# Creates .env for compose.yaml with fresh secrets. Run once from the repository root:
#
#   ./docker/setup.sh                    local instance at http://localhost, mails in Mailpit
#   ./docker/setup.sh wg.example.com     public instance with HTTPS (fill in SMTP_* afterwards)
#
# An existing .env is never overwritten; empty secrets in it are filled in.
set -eu
# .env holds the instance's secrets: readable by its owner only, from the first write on.
umask 077

cd "$(dirname "$0")/.."
command -v openssl >/dev/null || { echo "openssl is required." >&2; exit 1; }

domain="${1:-}"
if [ ! -f .env ]; then
	# POSTGRES_PASSWORD is fixed in the database volume when it is first created.
	if command -v docker >/dev/null && docker volume inspect manawg_db-data >/dev/null 2>&1; then
		echo "Warning: the volume manawg_db-data exists, but .env does not. New secrets will not match its database; restore the old .env, or run 'docker compose down -v' to delete the data (docs/self-hosting.md)." >&2
	fi
	cp .env.example .env
	if [ -n "$domain" ]; then
		sed -i.bak \
			-e "s|^APP_URL=.*|APP_URL=https://$domain|" \
			-e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$domain|" \
			-e "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=|" \
			-e "s|^SMTP_HOST=.*|SMTP_HOST=|" \
			-e "s|^SMTP_PORT=.*|SMTP_PORT=587|" \
			-e "s|^SMTP_ADMIN_EMAIL=.*|SMTP_ADMIN_EMAIL=noreply@$domain|" \
			.env
		rm -f .env.bak
	fi
	echo "Created .env"
elif [ -n "$domain" ]; then
	echo ".env exists and is left as it is. For $domain, edit these keys there yourself:" >&2
	echo "  APP_URL=https://$domain  SITE_ADDRESS=$domain  COMPOSE_PROFILES=(empty)" >&2
	echo "  SMTP_HOST  SMTP_PORT  SMTP_ADMIN_EMAIL=noreply@$domain" >&2
fi

get() { sed -n "s/^$1=//p" .env | tail -n 1; }
set_value() {
	sed -i.bak "s|^$1=.*|$1=$2|" .env
	rm -f .env.bak
}
fill() { [ -n "$(get "$1")" ] || set_value "$1" "$2"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
	header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
	now=$(date +%s)
	payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" $((now + 315360000)) | b64url)
	signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
	printf '%s.%s.%s' "$header" "$payload" "$signature"
}

fill POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fill MANAWG_APP_DB_PASSWORD "$(openssl rand -hex 24)"
fill MEMBER_SESSION_SECRET "$(openssl rand -hex 32)"
fill CRON_SECRET "$(openssl rand -hex 32)"
if [ -z "$(get JWT_SECRET)" ]; then
	secret=$(openssl rand -hex 32)
	set_value JWT_SECRET "$secret"
	set_value ANON_KEY "$(jwt anon "$secret")"
	set_value SERVICE_ROLE_KEY "$(jwt service_role "$secret")"
fi
chmod 600 .env

echo "Secrets are in .env. Next: docker compose up -d, then open $(get APP_URL)"
if [ -z "$(get SMTP_HOST)" ]; then
	echo "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_ADMIN_EMAIL in .env first: sign-in needs mail."
fi
if [ -z "$(get LEGAL_URL)" ]; then
	echo "LEGAL_URL not set: no legal links are shown. Set it before others use this instance." >&2
fi
