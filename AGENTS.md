# ManaWG agent workflow

Keep product intent and implementation artifacts in the repository so work
survives a chat session.

## Required workflow

1. For a new feature or architectural change, use OpenSpec: `spec -> plan -> tasks -> implement`
   (`openspec list`, `openspec status`, `openspec validate`; repo rules live under `openspec/`).
2. Reuse existing patterns and dependencies. Keep changes narrowly scoped.
3. Before handoff, run the gates in `README.md` (lint, typecheck, unit, build, e2e) and report exact results.

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
