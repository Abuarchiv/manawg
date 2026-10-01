# ManaWG

Shared-household app (expenses, chores, shopping, inventory, calendar, chat, pinboard) at
https://app.manawg.com. Next.js 15 App Router, React 19, Supabase Auth, Postgres via Drizzle,
Tailwind 4 with shadcn/base-ui, Playwright.

## Layout

```
apps/web/
  src/app/        routes only: pages, layouts, API handlers (thin, call core/features)
  src/core/       domain-neutral building blocks: db, auth, guards, http, offline, notifications, infra
  src/features/   vertical slices (chat, chores, events, expenses, inventory, pinnwand, shopping)
                  a feature may import core/, shared/ and itself, never another feature
  src/components/ reusable UI: ui/ (shadcn), animate-ui/ (motion variants), app/ (shell), wg/ (WG-wide)
  src/shared/     presentation-level utilities: theme, fonts, css, brand, analytics, identity
  drizzle/        SQL migrations (generated with `pnpm db:generate`, applied with `pnpm db:migrate`)
  e2e/            Playwright specs (fixture mode needs no database)
  tests/          node:test suites that are not colocated with a module
  scripts/        CI gates and the migrator
docs/             brand contract, runbooks, release evidence
openspec/         change proposals and specs
```

## Commands

```
pnpm install
pnpm dev                          # http://localhost:3000
pnpm lint                         # biome (whole repo)
pnpm --filter @manawg/web lint   # biome + feature-boundary + wg-auth-invariant checks
pnpm typecheck
pnpm --filter @manawg/web test:unit
pnpm build
pnpm --filter @manawg/web test:e2e:fixtures   # full Playwright suite against a fixture build
```

Environment variables are documented in `apps/web/.env.example`. Agent rules are in `AGENTS.md`.

## Design language

[Brandbook v1.0](docs/brand/brandbook.html) is the app's visual source of truth.
[Implementation rules](docs/brand/design-language.md) connect it to the shared theme,
components and brand assets.
