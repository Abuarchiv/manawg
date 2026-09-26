# ManaWG agent workflow

OpenClaw is the project orchestrator. Keep product intent and implementation
artifacts in the repository so work survives a chat session.

## Required workflow

1. For a new feature or architectural change, use OpenSpec: `spec -> plan -> tasks -> implement`.
2. Use Superpowers for brainstorming, implementation planning, TDD, code review, and verification.
3. Reuse existing patterns and dependencies. Keep changes narrowly scoped.
4. Before handoff, run the applicable lint, typecheck, test, build, and E2E gates and report exact results.

## Safety

- Preserve existing working-tree changes; never reset or discard user work.
- Do not deploy, change production data, send public messages, or spend money without explicit approval.
- Treat secrets and environment files as local-only; never print or request their values.

## Current development and environment separation

- Current development (2026-09-22) is tracked in `fix/audit-158` / PR #300 (`fix: resolve 14 critical/high bugs from manawg-app audit`). Keep unfinished agent work in its own branch or worktree; the existence of a branch is not merge approval. Do not merge all agent branches together.
- Parallel local work currently includes `fix/audit-20260922-app` (layout/attachment/chat WIP), `fix/b-db-20260922` (cron WIP), and clean agent branch scaffolds `fix/a-auth-20260922`, `fix/b-frontend-20260922`, `fix/b-infra-20260922`, and `fix/b-types-20260922`. Older `codex/issue-swarm-*` and `codex/release-*` worktrees remain independent; inspect each committed and uncommitted diff before integration.
- Preview and Production are separate environments and must remain separate. Branches separate development work; credentials, deployment checks, and explicit workflow gates separate environments. Preview is for exact-SHA validation with Preview-only credentials and data. Production changes only through `.github/workflows/migrate-production.yml` on `main`, using the exact `candidate_sha`, a matching successful `preview_run_id`, and `MIGRATE_PRODUCTION`.
- Never treat local, fixture, or Preview success as Production proof. Never use Production credentials or data in Preview. If Preview/Auth/RLS or migration gates fail, keep the PR open and report the external blocker; do not bypass required checks.

## Test account (Production)

- Login on https://app.manawg.com with "E-Mail und Passwort": `testuser@manawg.com` / `Mana-8743778e9c0e-Test`.
- Supabase project `bwsvsvfgbrsonepffqff`, user id `21d891cd-1bda-428a-84ad-cf9e5392d64e`, e-mail already confirmed, created 2026-09-25.
- Test-only account without real data; this is the one deliberate exception to the local-only secrets rule. Do not use it in Preview.

## Project commands

- OpenSpec: `openspec list --json`, `openspec status`, `openspec validate`
- Package manager: `pnpm`
- Repository-specific OpenSpec instructions live under `openspec/`.

## WG header design

- Keep the WG header free of search controls. The user explicitly removed the search icon; restore a header search entry only on a new explicit user request. This supersedes older design plans that place search in the header.
- Show account/settings as an original shadcn ghost icon button with a 44px touch target and an accessible label. Keep the visible control icon-only, without the text "Konto & WG".

## Brandbook

For UI, typography, icons, motion, or product wording, read
[the design contract](docs/brand/design-language.md) and the relevant chapter of
[Brandbook v1.0](docs/brand/brandbook.html) before editing. This source supersedes
older visual-design documents. Verify the changed view in light/dark and at a
320px viewport; retain the header accessibility rules above. Colored member
avatars (`memberTint` in `MemberAvatar.tsx`) are an intentional, documented
exception to the monochrome palette; keep them colored.
