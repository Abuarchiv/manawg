# ManaWG agent workflow

Keep product intent and implementation artifacts in the repository so work
survives a chat session.

## Required workflow

1. For a new feature or architectural change, use OpenSpec: `spec -> plan -> tasks -> implement`
   (`openspec list`, `openspec status`, `openspec validate`; repo rules live under `openspec/`).
2. Reuse existing patterns and dependencies. Keep changes narrowly scoped.
3. Before handoff, run `pnpm verify` (the CI `validate` steps) and the fixture e2e suite
   (`pnpm --filter @manawg/web test:e2e:fixtures`), and report exact results. Gate on the exit
   code, never on piped output.

## Code conventions

The rules below are enforced by `apps/web/scripts/check-architecture.mjs` (part of lint and CI);
the full layer matrix is in [docs/architecture.md](docs/architecture.md#layering).

- **Layers:** `app` → `fixtures` → `composition` → `features` → `components` → `core` →
  `shared`; import only downward. A feature never imports another feature; combine features in
  `composition/` (reads) or through `core/` (side effects such as `activity-feed`, `audit`).
- **Server code:** database and route logic of a feature lives in `features/<x>/server/` and
  starts with `import 'server-only'`. Client hooks and components never import `server/`.
- **API routes:** wrap handlers in `withWgRoute`, validate bodies with `parseBody`, answer errors
  with the helpers and `HTTP` constants in `core/http/api-errors.ts`, guard with
  `requireWgMember` / `requireWgAdmin` / `requireOwnerOrAdmin`. Retried writes use
  `withIdempotentWrite`; never call the claim helpers directly.
- **Client data:** lists that sync with the server use `useSyncedCollection`; connectivity and
  visibility come from `core/hooks/use-online-status.ts`. Do not add new `online` listeners.
- **Size:** source files stay at or under 400 lines, test files at or under 800. Split by
  responsibility (sections, hooks, pure helpers), not into arbitrary chunks.
- **Tests:** unit tests are `*.test.ts` (next to the module, cross-cutting ones in
  `apps/web/tests/`), import real modules and mock dependencies with `node:test` `mock.module`.
  No `vm`, `transpileModule` or reading source files as text. `e2e/` only holds specs that drive
  a page or the HTTP API; shared e2e code goes in `e2e/support/`. Never skip or weaken a test to
  get green; a flaky test needs a root cause.
- **Comments:** English only (UI copy stays German), explain why the current code is the way it
  is, never narrate history ("used to", "previously", "now ...").
- **Baseline:** `apps/web/scripts/architecture-baseline.json` lists the remaining known
  exceptions and may only shrink. After fixing an entry, regenerate it with
  `node scripts/check-architecture.mjs --write-baseline` once the plain run reports no new
  violation. Never add entries by hand.

## Safety

- Preserve existing working-tree changes; never reset or discard user work.
- Do not deploy, change production data, send public messages, or spend money without explicit approval.
- Treat secrets and environment files as local-only; never print or request their values.
- Preview and Production stay separate. Production changes only go through
  `.github/workflows/migrate-production.yml` on `main` with an exact `candidate_sha`, a matching
  successful `preview_run_id`, and `MIGRATE_PRODUCTION`. Local, fixture, or Preview success is
  never Production proof; never use Production credentials in Preview.

## Branches

Only `main` exists. Open a branch per task, open a PR, and let the owner merge. Old WIP states
live as `archive/*` tags.

## Test account (Production)

- Login on https://app.manawg.com with "E-Mail und Passwort": `testuser@manawg.com` / `Mana-8743778e9c0e-Test`.
- Supabase project `bwsvsvfgbrsonepffqff`, user id `21d891cd-1bda-428a-84ad-cf9e5392d64e`.
- Test-only account without real data; this is the one deliberate exception to the local-only secrets rule. Do not use it in Preview.

## WG header design

- Keep the WG header free of search controls. Restore a header search entry only on a new explicit user request.
- Show account/settings as an original shadcn ghost icon button with a 44px touch target and an accessible label. Keep the visible control icon-only, without the text "Konto & WG".

## Brandbook

For UI, typography, icons, motion, or product wording, read
[the design contract](docs/brand/design-language.md) and the relevant chapter of
[Brandbook v1.0](docs/brand/brandbook.html) before editing. Verify the changed view in light/dark
and at a 320px viewport; retain the header accessibility rules above. Colored member avatars
(`memberTint` in `MemberAvatar.tsx`) are an intentional, documented exception to the monochrome
palette; keep them colored.
