# Self-hosting ManaWG

Deutsche Fassung: [self-hosting.de.md](self-hosting.de.md)

Most households do not need this: [app.manawg.com](https://app.manawg.com) is free and needs no
setup. Self-host when you want the data on a machine you control.

There are two ways:

- **[Docker](#docker)** (recommended): one `compose.yaml` runs the app, PostgreSQL, sign-in and
  image storage on any machine with Docker, from a laptop to a small server. No external accounts
  apart from an SMTP provider for a public instance.
- **[Vercel and Supabase](#vercel-and-supabase)**: the app on Vercel with a Supabase project, on
  the free tiers of both services.

## Docker

### Quick start

You need Docker with Compose v2 (Docker Desktop, OrbStack or Docker Engine on Linux), `git` and
`openssl`. The running instance uses about 500 MB of memory; building the app image needs about
3 GB once.

```sh
git clone https://github.com/Abuarchiv/manawg-app.git
cd manawg-app
./docker/setup.sh
docker compose up -d
```

`setup.sh` creates `.env` from [`.env.example`](../.env.example) with fresh secrets. The first
start downloads the database, sign-in and storage images, builds the app image from your checkout
(about ten minutes, as no app image is published yet) and sets up the database. Then open
[http://localhost](http://localhost) and create an account. Every mail, including the sign-in
codes, lands in Mailpit at [http://localhost:8025](http://localhost:8025).

`docker compose ps` lists the services; `setup` has exited with code 0 and the others are
running. If port 80 is taken, set `HTTP_PORT=8080` and `APP_URL=http://localhost:8080` in `.env`
and run `docker compose up -d` again.

While it builds, Compose reports that it cannot pull `ghcr.io/abuarchiv/manawg-app`; that is
expected. Once an image is published for `MANAWG_VERSION`, Compose pulls it instead and the first
start takes a minute or two.

To check the whole instance, run `./docker/smoke.sh`. It signs up a test account, creates a WG,
uploads a picture, calls the scheduled jobs and backs up and restores the data. It leaves that
test data behind, so run it on a local instance, not on one people use.

### What runs

| Service | Image | Does |
| --- | --- | --- |
| `app` | `ghcr.io/abuarchiv/manawg-app` | The Next.js app |
| `db` | `supabase/postgres` | PostgreSQL with the roles that Auth and Storage expect |
| `auth` | `supabase/gotrue` | Accounts, sign-in codes, mail confirmation, Google sign-in |
| `storage` | `supabase/storage-api` | Private receipt and announcement images, kept on a volume |
| `gateway` | `caddy` | The only published port: the app plus the few Auth and Storage routes a browser needs, HTTPS for a domain |
| `setup` | app image | Runs on every start, then exits: migrations, database role, storage bucket, mail templates. All steps are idempotent |
| `cron` | app image | Calls the scheduled jobs from `apps/web/vercel.json` (UTC) |
| `mailpit` | `axllent/mailpit` | Catches all mail locally (profile `mailpit`) |

Data lives in the volumes `db-data` (database) and `storage-data` (images). `docker compose down`
keeps them; `docker compose down -v` deletes them.

### Public instance with a domain

1. A server with Docker, a DNS record for your domain pointing at it, and ports 80 and 443 open.
2. Create the configuration for the domain:

   ```sh
   ./docker/setup.sh wg.example.com
   ```

   This sets `APP_URL=https://wg.example.com`, `SITE_ADDRESS=wg.example.com` and turns Mailpit
   off. Caddy fetches a Let's Encrypt certificate on the first start.
3. Fill in the SMTP account in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) and use
   a sender address in `SMTP_ADMIN_EMAIL` that your provider accepts. Any SMTP provider works,
   many have a free tier that is enough for a household. Sign-in needs mail, so this is required.
4. Set `LEGAL_URL` and `SUPPORT_EMAIL` (see [Legal pages and support](#legal-pages-and-support)).
5. Start it:

   ```sh
   docker compose up -d
   ```

Behind your own reverse proxy instead, keep `SITE_ADDRESS=:80`, set `HTTP_PORT` to a local port
and `TRUSTED_PROXIES` to the proxy's address (`private_ranges` covers proxies on the same host or
network), and let the proxy pass on `Host` and `X-Forwarded-Proto`. `APP_URL` is always the
address people open.

### Configuration

Every setting is in `.env`, described in [`.env.example`](../.env.example). After a change, run
`docker compose up -d`; `docker compose restart` does not read `.env` again.

| Setting | Required | Effect |
| --- | --- | --- |
| `APP_URL`, `SITE_ADDRESS` | yes | Address of the instance and what the gateway serves |
| `SMTP_*` | yes | Outgoing mail for sign-in codes, invitations and statements |
| Secrets (`POSTGRES_PASSWORD` … `CRON_SECRET`) | yes | Created by `setup.sh`. `ANON_KEY` and `SERVICE_ROLE_KEY` are signed with `JWT_SECRET`; change all three together |
| `LEGAL_URL`, `SUPPORT_EMAIL` | for public instances | Your legal pages and the address for error reports |
| `MANAWG_VERSION` | no | Image tag to run; `latest` is the newest published image |
| `GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET` | no | Google sign-in with your own OAuth client; redirect URI `<APP_URL>/auth/v1/callback`. Off by default, and the app then shows no Google buttons |
| `VAPID_*` | no | Push notifications, see below |

Optional features stay off without their settings, and the app keeps working:

- **Push notifications:** the public VAPID key is built into the browser code, so the published
  image has push turned off. Generate keys with `npx web-push generate-vapid-keys`, set
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com`), then
  build your own image with `docker compose up -d --build`.
- **Rate limiting** runs in the app's memory. That is enough for one app container; Upstash Redis
  is not needed.
- **Error reporting and product analytics** (Sentry, PostHog) are off.

`/api/health` reports what is off under `degradedFeatures`; `docker compose logs app` shows the
boot lines starting with `[env]`.

### Updating

Take a backup first (`./docker/backup.sh`). If Compose built the image from your checkout:

```sh
git pull
docker compose up -d --build
```

With a published image (`MANAWG_VERSION`), `docker compose pull && docker compose up -d` instead.
The `setup` service applies new migrations before the new app version starts. A change that needs
a manual step on self-hosted instances says so in its pull request.

### Backup and restore

```sh
./docker/backup.sh                                         # backups/manawg-<UTC time>.tar.gz
./docker/restore.sh backups/manawg-20261028-031500.tar.gz  # replaces this instance's data
```

The archive holds the database (app, accounts, storage metadata) and all images. Restore works on
a fresh machine too, after `./docker/setup.sh`. Scheduling, encryption and checking a restore are
in [backup and restore](database-recovery.md#docker).

## Vercel and Supabase

Everything fits into the free tiers of the services involved. Vercel's Hobby plan is for non-commercial use, and Supabase pauses free projects after a
period of inactivity (resume them in the dashboard). Budget about an hour for the first setup.

### What you need

| Service | Used for | Required |
| --- | --- | --- |
| [Supabase](https://supabase.com) | PostgreSQL, Auth, image storage | yes |
| [Vercel](https://vercel.com) | Hosting and cron jobs | yes |
| [Upstash Redis](https://upstash.com) | Rate limiting; API routes fail closed on Vercel without it | yes |
| An SMTP provider, e.g. [Resend](https://resend.com) | Sign-in codes and confirmation mails from Supabase Auth, mails sent by the app | yes |
| Web Push keys, Sentry | Push notifications, error reporting | no |

Locally you need Node 22, pnpm 9 (`corepack enable`) and `openssl`.

### 1. Get the code

Fork the repository on GitHub (so Vercel can deploy it and you can pull updates), then clone your
fork and install:

```sh
git clone https://github.com/<you>/manawg-app.git
cd manawg-app
pnpm install
```

### 2. Create the Supabase project

1. Create a project in the region closest to your users.
2. From **Project Settings**, note the project URL (**Data API**) and, under **API Keys**, the
   publishable key and a secret key.
3. From **Connect**, note two connection strings:
   - the **transaction pooler** (port `6543`) for the running app,
   - the **session pooler** (port `5432`) for migrations. The direct connection
     (`db.<ref>.supabase.co:5432`) works too, but only over IPv6 unless you add Supabase's IPv4
     add-on.

#### Runtime database role

The app should not connect as `postgres`. Create a role that can read and write rows but cannot
change the schema. In the Supabase **SQL Editor**, before running migrations:

```sql
create role manawg_app login bypassrls password '<long random password>';
```

Migration `0034_app_role_grants` grants this role access to every table, including future ones.
The app's runtime URL then uses this role on the transaction pooler:

```text
postgresql://manawg_app.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

`bypassrls` is intentional: the server enforces WG membership on every request, and row level
security is a second line of defense that blocks direct access through the Supabase Data API.

### 3. Apply the migrations

```sh
export DATABASE_MIGRATION_URL='postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require'
pnpm --filter @manawg/web db:migrate
pnpm --filter @manawg/web db:check
```

The migrator only accepts Supabase session connections on port `5432` and does not read `.env`
files. `db:check` verifies the schema, the migration ledger and the row level security setup.

### 4. Configure Supabase Auth

In **Authentication → URL Configuration**:

- **Site URL**: your app URL, e.g. `https://wg.example.com`.
- **Redirect URLs**: add `https://wg.example.com/auth/callback`.

In **Authentication → SMTP Settings**, enable custom SMTP. Supabase's built-in mail service only
delivers to members of your Supabase team and is rate limited, so real users would never receive
their sign-in code.

Then push the ManaWG mail templates. This step is required: it also sets the sign-in code length
to 8 digits, which the sign-in form expects. Create a personal access token under
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens):

```sh
SUPABASE_ACCESS_TOKEN=<token> node scripts/supabase-auth-templates.mjs \
  --ref <project-ref> \
  --app-url https://wg.example.com \
  --legal-url https://example.com \
  --apply
```

Run it once without `--apply` to see what would change. `--legal-url` is the site with your legal
pages (see [Legal pages and support](#legal-pages-and-support)).

The mail bodies and subjects pick German or English from the account's `locale` in the user
metadata. Accounts without one get German.

**Google sign-in (optional):** enable the Google provider under **Authentication → Providers**
with your own OAuth client. The redirect URI to register at Google is shown there. Without it, set
`GOOGLE_SIGN_IN=false` so the app hides its Google buttons.

### 5. Image storage

Create a Supabase Storage bucket that is **private**, has a file size limit of exactly **8 MiB**
and allows exactly `image/jpeg`, `image/png`, `image/webp`, `image/heic` and `image/heif`. The app
checks this configuration and disables uploads if it differs. Put its name into
`SUPABASE_STORAGE_BUCKET`.

### 6. Deploy on Vercel

`apps/web/vercel.json` turns off automatic deployments of `main`. Adapt two settings in your fork
first:

- Delete the `git` block (`"deploymentEnabled": { "main": false }`). Otherwise Vercel does not
  deploy pushes to `main`, and you would have to run `vercel deploy --prod` for every update.
- Set `regions` to the Vercel region next to your Supabase project (`fra1` is Frankfurt).

Then:

1. **Add New → Project**, import your fork and set **Root Directory** to `apps/web`. Framework,
   install and build commands come from `apps/web/vercel.json`.
2. Add the environment variables below for **Production**.
3. Deploy.

The cron jobs in `vercel.json` run at most once a day, which the Hobby plan allows.

#### Environment variables

Required:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Your app URL, e.g. `https://wg.example.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key. Server-only; needed for account deletion and Supabase Storage |
| `POSTGRES_URL` | Runtime URL with the `manawg_app` role on port `6543` |
| `MEMBER_SESSION_SECRET` | `openssl rand -hex 32`; signs calendar feeds and unsubscribe links |
| `CRON_SECRET` | `openssl rand -hex 32`; Vercel sends it to the cron routes |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | From your Upstash Redis database |
| `SUPABASE_STORAGE_BUCKET` | See [Image storage](#5-image-storage) |

Mail sent by the app itself (invitations, monthly statements, reminders):

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `STATEMENT_EMAIL_FROM` | Sender on a domain verified in your Resend account, e.g. `ManaWG <noreply@example.com>` |

Optional:

| Variable | Effect when set |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notifications (`npx web-push generate-vapid-keys`; subject `mailto:you@example.com`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Error reporting to your Sentry project |
| `NEXT_PUBLIC_LEGAL_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL` | See [Legal pages and support](#legal-pages-and-support) |

Leave `NEXT_PUBLIC_POSTHOG_*` empty: product analytics stays off.
Every variable is described in [`apps/web/.env.example`](../apps/web/.env.example).

### 7. Check the deployment

- `https://wg.example.com/api/health` answers `200` with `"status":"ok"`.
- The function log contains `[env] all variables present`. A line starting with
  `[env] MISSING REQUIRED` names what is missing; `[env] DEGRADED` names optional features that
  are off.
- Create an account with your e-mail address, enter the 8-digit code, create a WG and invite a
  second address.

### Updating on Vercel

```sh
git remote add upstream https://github.com/Abuarchiv/manawg-app.git   # once
git pull upstream main
pnpm install
pnpm --filter @manawg/web db:migrate   # with DATABASE_MIGRATION_URL exported
git push
```

Apply migrations before the new version goes live; the push to your fork deploys it. Keep your
own `vercel.json` changes if the pull reports a conflict there. A change that needs a manual step
says so in its pull request.

### Backups on Supabase

The Supabase free plan has no automatic backups. Take your own, see
[backup and restore](database-recovery.md#vercel-and-supabase).

## Legal pages and support

These apply to both ways. In Docker the settings are `LEGAL_URL` and `SUPPORT_EMAIL`.

- `NEXT_PUBLIC_LEGAL_URL` is the site with your `/impressum`, `/datenschutz` and `/agb`. The app
  and its mails link there. If it is unset, the links point to manawg.com, whose legal pages do
  not cover your instance. If you offer your instance to people outside your own household, you
  need your own imprint and privacy policy. Setting it also marks the instance as self-hosted:
  it does not announce itself to search engines as the official app.
- Links to "Über ManaWG", "Die WG-App" and "WG-Ratgeber" keep pointing to manawg.com, the
  project's site.
- `NEXT_PUBLIC_SUPPORT_EMAIL` receives the "Fehler per E-Mail melden" reports. In Docker an empty
  `SUPPORT_EMAIL` falls back to `SMTP_ADMIN_EMAIL`. On Vercel an unset value sends reports to the
  ManaWG maintainers, who cannot see your instance, so set it there.

## Getting help

Questions go to [Discussions](https://github.com/Abuarchiv/manawg-app/discussions), bugs to an
[issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) with the boot log lines
starting with `[env]`. Never post secrets, connection strings or keys.
