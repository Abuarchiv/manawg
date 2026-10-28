# Changelog

Notable changes to ManaWG. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Releases that need manual steps
for self-hosted instances (environment variables, Supabase settings) say so here.

## [Unreleased]

First public release under the AGPL-3.0.

### Added

- Docker setup for self-hosting: `compose.yaml` runs the app, PostgreSQL, Supabase Auth and
  Storage, a Caddy gateway with automatic HTTPS for a domain, scheduled jobs and, locally, Mailpit.
  `docker/setup.sh` creates the configuration, `docker/backup.sh` and `docker/restore.sh` back up
  and restore database and images. Release tags publish the image for `linux/amd64` and
  `linux/arm64` to `ghcr.io/abuarchiv/manawg-app`.
- Outgoing mail over SMTP (`SMTP_HOST` and friends) as an alternative to Resend.
- In-memory rate limiting for self-hosted instances without Upstash Redis.
- `pnpm --filter @manawg/web dev:fixtures` runs the app with sample data and without a database.
- Self-hosting guide (`docs/self-hosting.md`) and contributor documentation.
- `NEXT_PUBLIC_LEGAL_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` to point legal links and error reports
  at your own instance.
- `scripts/supabase-auth-templates.mjs` takes `--app-url` and `--legal-url`; `--ref` is now
  required.

### Changed

- Links in mails follow `NEXT_PUBLIC_APP_URL` instead of a fixed `https://app.manawg.com`.
- `db:migrate` also accepts the Supabase session pooler on port 5432, so migrations run from
  networks without IPv6.

### Removed

- AWS S3 as image storage. Images live in Supabase Storage only; `IMAGE_STORAGE_PROVIDER`,
  `AWS_*` and `S3_BUCKET` are gone.
