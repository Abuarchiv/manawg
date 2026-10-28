# Self-hosting ManaWG

This guide runs your own ManaWG instance on Vercel and Supabase. Most households do not need
this: [app.manawg.com](https://app.manawg.com) is free and needs no setup. Self-host when you want
the data in accounts you control.

Everything below fits into the free tiers of the services involved. Vercel's Hobby plan is for
non-commercial use, and Supabase pauses free projects after a period of inactivity (resume them in
the dashboard). Budget about an hour for the first setup.

## What you need

| Service | Used for | Required |
| --- | --- | --- |
| [Supabase](https://supabase.com) | PostgreSQL, Auth, optional image storage | yes |
| [Vercel](https://vercel.com) | Hosting and cron jobs | yes (see [Other hosts](#other-hosts)) |
| [Upstash Redis](https://upstash.com) | Rate limiting; API routes fail closed in production without it | yes |
| An SMTP provider, e.g. [Resend](https://resend.com) | Sign-in codes and confirmation mails from Supabase Auth, mails sent by the app | yes |
| S3 bucket or Supabase Storage | Receipt and announcement images | yes |
| Web Push keys, Sentry | Push notifications, error reporting | no |

Locally you need Node 22, pnpm 9 (`corepack enable`) and `openssl`.

## 1. Get the code

Fork the repository on GitHub (so Vercel can deploy it and you can pull updates), then clone your
fork and install:

```sh
git clone https://github.com/<you>/manawg-app.git
cd manawg-app
pnpm install
```

## 2. Create the Supabase project

1. Create a project in the region closest to your users.
2. From **Project Settings**, note the project URL (**Data API**) and, under **API Keys**, the
   publishable key and a secret key.
3. From **Connect**, note two connection strings:
   - the **transaction pooler** (port `6543`) for the running app,
   - the **session pooler** (port `5432`) for migrations. The direct connection
     (`db.<ref>.supabase.co:5432`) works too, but only over IPv6 unless you add Supabase's IPv4
     add-on.

### Runtime database role

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

## 3. Apply the migrations

```sh
export DATABASE_MIGRATION_URL='postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require'
pnpm --filter @manawg/web db:migrate
pnpm --filter @manawg/web db:check
```

The migrator only accepts Supabase session connections on port `5432` and does not read `.env`
files. `db:check` verifies the schema, the migration ledger and the row level security setup.

## 4. Configure Supabase Auth

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

**Google sign-in (optional):** enable the Google provider under **Authentication → Providers**
with your own OAuth client. The redirect URI to register at Google is shown there.

## 5. Image storage

Pick one provider.

**Supabase Storage:** create a bucket that is **private**, has a file size limit of exactly
**8 MiB** and allows exactly `image/jpeg`, `image/png`, `image/webp`, `image/heic` and
`image/heif`. The app checks this configuration and disables uploads if it differs.

```text
IMAGE_STORAGE_PROVIDER=supabase
SUPABASE_STORAGE_BUCKET=<bucket name>
```

**AWS S3:** set `IMAGE_STORAGE_PROVIDER=aws`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `S3_BUCKET`. The bucket must allow `PUT` from your app origin (CORS)
for presigned uploads.

## 6. Deploy on Vercel

`apps/web/vercel.json` is the configuration of the official instance, which releases manually.
Adapt two settings in your fork first:

- Delete the `git` block (`"deploymentEnabled": { "main": false }`). Otherwise Vercel does not
  deploy pushes to `main`, and you would have to run `vercel deploy --prod` for every update.
- Set `regions` to the Vercel region next to your Supabase project (`fra1` is Frankfurt).

Then:

1. **Add New → Project**, import your fork and set **Root Directory** to `apps/web`. Framework,
   install and build commands come from `apps/web/vercel.json`.
2. Add the environment variables below for **Production**.
3. Deploy.

The cron jobs in `vercel.json` run at most once a day, which the Hobby plan allows.

### Environment variables

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
| `IMAGE_STORAGE_PROVIDER` and its variables | See [Image storage](#5-image-storage) |

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

## 7. Check the deployment

- `https://wg.example.com/api/health` answers `200` with `"status":"ok"`.
- The function log contains `[env] all variables present`. A line starting with
  `[env] MISSING REQUIRED` names what is missing; `[env] DEGRADED` names optional features that
  are off.
- Create an account with your e-mail address, enter the 8-digit code, create a WG and invite a
  second address.

## Legal pages and support

- `NEXT_PUBLIC_LEGAL_URL` is the site with your `/impressum`, `/datenschutz` and `/agb`. The app
  and its mails link there. If it is unset, the links point to manawg.com, whose legal pages do
  not cover your instance. If you offer your instance to people outside your own household, you
  need your own imprint and privacy policy. Setting it also marks the instance as self-hosted:
  it no longer announces itself to search engines as the official app.
- Links to "Über ManaWG", "Die WG-App" and "WG-Ratgeber" keep pointing to manawg.com, the
  project's site.
- `NEXT_PUBLIC_SUPPORT_EMAIL` receives the "Fehler per E-Mail melden" reports. Unset, reports go
  to the ManaWG maintainers, who cannot see your instance.
- The name and logo "ManaWG" are not covered by the code license. Read
  [TRADEMARK.md](../TRADEMARK.md) before you run a public instance.

## Updating

```sh
git remote add upstream https://github.com/Abuarchiv/manawg-app.git   # once
git pull upstream main
pnpm install
pnpm --filter @manawg/web db:migrate   # with DATABASE_MIGRATION_URL exported
git push
```

Apply migrations before the new version goes live; the push to your fork deploys it. Keep your
own `vercel.json` changes if the pull reports a conflict there. Read the
[changelog](../CHANGELOG.md) first; releases that need manual steps say so there.

## Backups

The Supabase free plan has no automatic backups. Export your database regularly, for example
with `supabase db dump` from the [Supabase CLI](https://supabase.com/docs/guides/cli), and keep
the dumps somewhere other than Supabase. See [database recovery](database-recovery.md).

## Other hosts

ManaWG is a standard Next.js app (`pnpm build`, then `pnpm --filter @manawg/web start`), but only
Vercel is tested. On another Node 22 host:

- Set `VERCEL_ENV=production`. The app uses it to switch on production behavior: outgoing mail,
  strict environment checks and fail-closed rate limiting.
- Call each route in the `crons` list of `apps/web/vercel.json` on its schedule (UTC) with the
  header `Authorization: Bearer $CRON_SECRET`, e.g. from cron or a systemd timer.
- Serve the app over HTTPS only.

## Getting help

Open an [issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) with the boot log
lines starting with `[env]`. Never post secrets, connection strings or keys.
