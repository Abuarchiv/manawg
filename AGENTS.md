# ManaWG agent workflow

Keep product intent and implementation artifacts in the repository so work
survives a chat session.

## Required workflow

1. For a new feature or architectural change, use OpenSpec: `spec -> plan -> tasks -> implement`
   (`openspec list`, `openspec status`, `openspec validate`; repo rules live under `openspec/`).
2. Reuse existing patterns and dependencies. Keep changes narrowly scoped.
3. Before handoff, run the gates in `README.md` (lint, typecheck, unit, build, e2e) and report exact results.

## Code conventions

`apps/web/scripts/check-architecture.mjs` (part of `lint` and CI) enforces these; layers and
rationale are in [docs/architecture.md](docs/architecture.md). The baseline file only shrinks.

- Layers: `app -> fixtures -> composition -> features -> components -> core -> shared`; each
  layer imports only layers to its right. A feature never
  imports another feature; cross-feature reads go through `src/composition/`.
- Source files stay under 400 lines, test files under 800. Split along responsibilities and
  keep the old file as the entry when importers should not change.
- Comments are English and describe the code as it is; no history narration.
- Unit tests are `*.test.ts` (next to the module or in `apps/web/tests/`), import real modules
  through `tests/support/register.mjs` and mock with `node:test` `mock.module`; no `vm`,
  `transpileModule` or reading source text. E2E specs are `e2e/*.spec.ts` with helpers in
  `e2e/support/` and only cover what needs a browser or a running server.
- Add a test for a fixed bug as a regression test at the cheapest level that catches it.
  Tests that only check copy or presentation already covered by e2e are not added.

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
