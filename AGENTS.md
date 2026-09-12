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

## Project commands

- OpenSpec: `openspec list --json`, `openspec status`, `openspec validate`
- Package manager: `pnpm`
- Repository-specific OpenSpec instructions live under `openspec/`.

## WG header design

- Keep the WG header free of search controls. The user explicitly removed the search icon; restore a header search entry only on a new explicit user request. This supersedes older design plans that place search in the header.
- Show account/settings as an original shadcn ghost icon button with a 44px touch target and an accessible label. Keep the visible control icon-only, without the text "Konto & WG".
