# Changelog

Notable changes to ManaWG. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Releases that need manual steps
for self-hosted instances (environment variables, Supabase settings) say so here.

## [Unreleased]

First public release under the Apache License 2.0.

### Added

- Self-hosting guide (`docs/self-hosting.md`) and contributor documentation.
- `NEXT_PUBLIC_LEGAL_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` to point legal links and error reports
  at your own instance.
- `scripts/supabase-auth-templates.mjs` takes `--app-url` and `--legal-url`; `--ref` is now
  required.

### Changed

- Links in mails follow `NEXT_PUBLIC_APP_URL` instead of a fixed `https://app.manawg.com`.
- `db:migrate` also accepts the Supabase session pooler on port 5432, so migrations run from
  networks without IPv6.
