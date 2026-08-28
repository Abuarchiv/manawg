# ManaWG Repository and Vercel Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the landing page and product app from independent GitHub repositories and Vercel projects, while preserving one browser origin and strict Preview/Production database isolation.

**Architecture:** Keep exactly two deployable Vercel projects: `manawg-landing` owns the visible domain and rewrites product routes to `manawg`; `manawg` owns API routes, database access, and crons. Each project uses Vercel's built-in Preview and Production environments, so four Vercel projects are unnecessary. The product is never a browser-visible navigation origin.

**Tech Stack:** GitHub, Vercel Git deployments and rewrites, Next.js 15, pnpm, Drizzle/`pg`, Supabase PostgreSQL.

**Spec:** User request of 2026-08-28; database-cutover constraints are in `docs/plans/2026-08-28-neon-to-supabase-migration.md`.

## Global Constraints

- Use Node 22 for local checks; do not run this repository with Node 26.
- Reuse Vercel projects `manawg-landing` and `manawg`; do not create four replacement projects.
- Keep `manawg.com` assigned only to `manawg-landing`; requests for `/wg`, `/api`, `/neu`, `/offline`, `/.well-known/*`, and `/wg-assets/*` stay transparent rewrites.
- The web project alone receives database credentials, server secrets, and all three cron definitions.
- `manawg-preview` (`sthiwjebcwwiphashgla`) and `manawg-production` (`bwsvsvfgbrsonepffqff`) must never share a Vercel environment.
- Do not copy `identity.ts` into independent sources. Its localStorage format must have one versioned source of truth.
- Do not use the currently dirty `manawg` checkout as a repository-split source. Its Supabase work is WIP and requires its own review and gate.
- Do not push, change Vercel variables/domains, migrate data, or delete/transfer projects without an explicit execution approval.

---

### Task 1: Lock the repository boundary and shared-code ownership

**Files:**
- Inspect: `apps/web/**`, `apps/landing/**`, `packages/shared/**`, `pnpm-workspace.yaml`
- Create after approval: private `Abuarchiv/manawg-shared` repository
- Modify after approval: package names/imports in the new app and landing repositories

**Produces:** Three clear ownership units: `manawg-app`, `manawg-landing`, and a versioned private `@abuarchiv/manawg-shared` package. The package is the only owner of identity, PWA, theme, branding, and common URL helpers.

- [ ] Record the SHA used as the clean split base and record the current dirty-worktree diff separately; do not mix them.
- [ ] Create the private shared repository from the existing `packages/shared` contents, preserving its exports and tests.
- [ ] Rename its publishable package to `@abuarchiv/manawg-shared`, give it an initial immutable version, and publish only the files required by its `exports` map.
- [ ] Configure both deployable repositories to install the exact shared-package version through the private registry; add a read-only package token to Vercel only as a sensitive build variable.
- [ ] Replace every `@manawg/shared/...` import in both deployable repositories with the published-package path; do not retain a local fallback copy.
- [ ] Run the identity, theme, PWA, and package-tarball checks before publishing the first version.

**Verification:** `pnpm pack --dry-run` lists the exported source files, the shared test suite passes, and `rg -n 'workspace:\*|@manawg/shared'` finds neither obsolete dependency in the two deployable repositories.

**Anti-pattern guards:** no Git submodule, Git URL dependency, unversioned `latest`, or copied `identity.ts`.

### Task 2: Publish the prepared landing repository

**Files:**
- Modify: `/Users/abu/Company/manawg-landing/package.json`
- Modify: `/Users/abu/Company/manawg-landing/pnpm-workspace.yaml`
- Modify: `/Users/abu/Company/manawg-landing/apps/landing/package.json`
- Modify: `/Users/abu/Company/manawg-landing/apps/landing/next.config.ts`
- Remove after shared-package adoption: `/Users/abu/Company/manawg-landing/packages/shared/**`

**Consumes:** The first published shared-package version.

**Produces:** GitHub repository `Abuarchiv/manawg-landing`, branch `main`, containing landing-only code and no database/product source.

- [ ] Change the local `master` branch to `main` before connecting it to GitHub.
- [ ] Replace the `workspace:*` shared dependency with the exact private package version and remove the copied workspace package.
- [ ] Preserve the landing rewrite table exactly: `/wg`, `/wg/:path*`, `/api/:path*`, `/neu`, `/offline`, `/.well-known/:path*`, and `/wg-assets/:path*`.
- [ ] Preserve the root PWA files (`public/manifest.json`, `public/sw.js`) and root-scope registration.
- [ ] Create and push the new private GitHub repository only after the local landing gate is green.

**Verification:** `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the landing Playwright tests pass from the standalone repository.

**Anti-pattern guards:** do not put Drizzle, database URLs, cron routes, or web API code into this repository.

### Task 3: Create the clean product-app repository

**Files:**
- Create: fresh `Abuarchiv/manawg-app` checkout based on an audited clean SHA
- Keep: `apps/web/**`, root pnpm configuration, lockfile, Biome configuration, and product-relevant documentation
- Remove from the new app repository: `apps/landing/**` and local `packages/shared/**`
- Modify: root package/workspace configuration and `apps/web/package.json`

**Consumes:** The same published shared-package version and a reviewed Supabase change set, if it is ready.

**Produces:** GitHub repository `Abuarchiv/manawg-app`, branch `main`, with no landing source and one Vercel deploy target at `apps/web`.

- [ ] Build the new repository in a fresh clone/worktree, never by deleting files from the dirty source checkout.
- [ ] Preserve the product `assetPrefix: '/wg-assets'`; its assets are served through the landing rewrite, not from a visible app subdomain.
- [ ] Keep `apps/web/vercel.json`, including the existing cron schedule; no cron belongs in the landing repository.
- [ ] Replace the workspace shared dependency with the exact private package version and remove `transpilePackages` only if the installed package's built output makes it unnecessary.
- [ ] Add a repository-specific README describing the upstream landing rewrite contract and the Preview/Production environment matrix.
- [ ] Create and push `Abuarchiv/manawg-app` only after its isolated gate is green.

**Verification:** under Node 22 run `pnpm install --frozen-lockfile && pnpm check:deps && pnpm lint && pnpm typecheck && pnpm test && pnpm build` in the new app repository.

**Anti-pattern guards:** do not use `git filter-repo` on the existing dirty checkout and do not bring the landing PWA root files into the app repository.

### Task 4: Reconnect the two existing Vercel projects

**Files:**
- Verify: `manawg-landing/apps/landing/vercel.json`
- Verify: `manawg-app/apps/web/vercel.json`
- Change in Vercel Dashboard: Git repository connection, production branch, root directory, and ignored-build settings

**Consumes:** Both GitHub repositories with passing builds.

**Produces:** Existing project `manawg-landing` deploys from `Abuarchiv/manawg-landing`, and existing project `manawg` deploys from `Abuarchiv/manawg-app`.

- [ ] Save the current project IDs, deployment URLs, domain assignment, production branch, and target-variable key names before changing either Git connection.
- [ ] Reconnect `manawg-landing` to the landing repository with root directory `apps/landing` and production branch `main`.
- [ ] Reconnect `manawg` to the app repository with root directory `apps/web` and production branch `main`.
- [ ] Keep `manawg.com` only on `manawg-landing`; leave `manawg` as the internal rewrite upstream.
- [ ] Confirm the old monorepo is no longer the deployment source, but keep the repository and its deployments recoverable until the observation window ends.

**Verification:** each new project connection produces a successful Preview deployment from a non-`main` branch without modifying the production domain.

**Anti-pattern guards:** no domain transfer to the app project, no Vercel project deletion, and no DNS/nameserver modification without a record-level check.

### Task 5: Define the Preview and Production contract

**Files:**
- Verify/modify only if names change: `apps/landing/next.config.ts`, `apps/web/next.config.ts`
- Change in Vercel: environment-variable targets and a persistent `preview` branch/domain pairing

**Consumes:** Both Vercel projects connected to their separate repositories.

**Produces:** One explicit upstream pairing per environment.

| Vercel project | Preview | Production |
| --- | --- | --- |
| `manawg-landing` | `NEXT_PUBLIC_APP_URL` is the landing preview origin; `APP_ZONE_URL` is the app `preview` branch URL | `NEXT_PUBLIC_APP_URL=https://manawg.com`; `APP_ZONE_URL` is the app production deployment URL |
| `manawg` | `NEXT_PUBLIC_APP_URL` is the landing preview origin; runtime DB URL targets `manawg-preview`; migration URL targets the preview project's direct/session endpoint | `NEXT_PUBLIC_APP_URL=https://manawg.com`; runtime DB URL targets `manawg-production`; migration URL targets the production project's direct/session endpoint |

- [ ] Create a persistent `preview` branch in both repositories and use Vercel's branch URL or a verified branch domain for each; record the two exact URLs.
- [ ] Scope landing variables to their correct Vercel target. A landing Preview must never rewrite to the production app.
- [ ] Scope all app database variables and existing app secrets to their correct target. Landing receives no database or server secret.
- [ ] Keep Preview pull-request deployments available, but treat the paired `preview` branches as the only integration environment for cross-zone testing.
- [ ] Redeploy after every variable change; Vercel does not apply a changed variable to an already-created deployment.

**Verification:** list variable names by target without printing values; inspect the resulting Preview and Production deployment metadata; compare each deployment's project/ref with the intended target.

**Anti-pattern guards:** never set a Preview `APP_ZONE_URL` to production, never use the same Supabase ref in both targets, and never expose a database URL with a `NEXT_PUBLIC_` name.

### Task 6: Run the Supabase cutover as an independent change

**Files:**
- Review and commit separately: existing dirty changes under `apps/web/**`, including connection, transaction, migration-script, middleware, and environment-example files
- Follow: `docs/plans/2026-08-28-neon-to-supabase-migration.md`

**Consumes:** The product app deployment pipeline and the Preview/Production environment matrix.

**Produces:** The app's Preview environment uses only `manawg-preview`; Production uses only `manawg-production`; data and schema are verified before production traffic changes.

- [ ] Turn the current uncommitted Supabase work into a small, reviewed app-repository commit and pass the full product gate before configuring any Vercel database value.
- [ ] Execute the dump/restore and Drizzle migration sequence against Preview first, using the direct/session connection for DDL and the transaction pooler only for runtime.
- [ ] Exercise Preview reads, writes, transactions, cron authorization, and rollback behavior against `manawg-preview`.
- [ ] Schedule the production maintenance window, take a fresh verified source backup, and repeat the documented production cutover only with a human Go decision.
- [ ] Keep Neon recoverable through the agreed observation period; do not delete or repurpose it during cutover.

**Verification:** schema/ledger comparison, controlled data counts, app health/read-write checks, a new successful deployment marker per target, and the complete product gate.

**Anti-pattern guards:** no automatic production migration from an unreviewed Vercel build, no `drizzle-kit push`, no `supabase db push`, and no destructive restore flags.

### Task 7: Verify one-origin behavior before traffic cutover

**Files:**
- Create: `manawg-landing/apps/landing/e2e/app-zone-proxy.spec.ts`
- Verify: `manawg-landing/apps/landing/e2e/landing-integrity.spec.ts`
- Verify: `manawg-app/apps/web/e2e/**`

**Consumes:** paired Preview deployments and the Preview Supabase target.

**Produces:** automated and manual evidence that the domain boundary still behaves as one web application.

- [ ] Add a focused Playwright smoke that starts the app and landing locally, opens the landing origin, and verifies the rewrite responses for `/wg`, `/api/health`, and a product asset under `/wg-assets/`.
- [ ] Seed an existing identity in the landing-origin localStorage and verify navigation into `/wg/...` retains it without changing the browser origin.
- [ ] Verify `/manifest.json` and `/sw.js` are served by the landing origin and that the worker scope remains `/`.
- [ ] Run the same route, asset, identity, and PWA checks against the paired Preview deployment before testing Production.
- [ ] Verify the three crons are present only on the app Vercel project and do not run against production while Preview is under test.

**Verification:** all local gates pass; Preview returns no product-asset 404s, no cross-origin navigation, and no Preview request reaches `manawg-production`.

**Anti-pattern guards:** a plain landing-render test is insufficient; do not accept a visible app subdomain as proof of integration.

### Task 8: Promote safely and retire only the old deployment wiring

**Files:**
- Modify after the observation period: old monorepo deployment documentation and obsolete landing workspace references
- Preserve: original repository history and a tagged rollback point

**Consumes:** a passed Preview gate, explicit production Go decision, and successful production smoke results.

**Produces:** the two-repository/two-project topology is the active production source, with a recoverable rollback path.

- [ ] Deploy the app production upstream first, then deploy/promote the landing production configuration that rewrites to it.
- [ ] Run a non-destructive production smoke from `https://manawg.com`: landing route, product route, product asset, API health, identity persistence, PWA files, and canonical URLs.
- [ ] Watch Vercel deployment health and database errors for the agreed observation period; immediately stop promotion on fresh failures.
- [ ] After the observation period, remove only obsolete landing code and workspace wiring from the old monorepo in a separate reviewed commit.
- [ ] Keep the old repository, old deployments, and Neon backup until the owner explicitly approves their retirement.

**Verification:** production evidence is from fresh deployment IDs and live response checks, not old logs; the old Git repository is no longer an active Vercel deployment source.

**Anti-pattern guards:** no same-day irreversible deletion and no claim that the split is complete before Preview, Production, and data-source evidence all pass.

## Plan Self-Review

- **Coverage:** covers repository ownership, shared code, Vercel reconnection, Preview/Production pairing, Supabase isolation, one-origin routing, PWA, crons, verification, and reversible retirement.
- **Minimality:** retains two existing Vercel projects; the only additional repository is the necessary canonical shared package, avoiding a second identity implementation.
- **Execution boundary:** all external writes and database migrations remain blocked until explicit approval.
