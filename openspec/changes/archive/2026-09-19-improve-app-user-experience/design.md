## Context

The accepted user-experience specification lives in `docs/superpowers/specs/2026-09-04-app-user-experience.md`. Source baseline is `8f845cd`; the original checkout and planning work are preserved in a separate directory.

## Goals / Non-Goals

**Goals:** Improve connected daily flows with existing components; use the existing member and accounting guards; complete safe local verification and exact-revision release workflow wiring.

**Non-Goals:** No production/provider mutation, resident-test fabrication, native-app rewrite, new UI framework, or invented operator/legal information.

## Decisions

1. One isolated integration worktree with explicit disjoint file ownership. Astra owns UI, Luna owns backend/account and workflow implementation, and Terra independently reviews completed packages. Root owns integration/commits and the evidence ledger.
2. Follow the UX specification's recommended defaults where the user authorized implementation. Keep five tabs, contextual first action, explicit financial confirmation, and persistent authorized member leave. Avoid aesthetic questions that do not change business behavior.
3. Reuse existing accounting queries/transactions; a settlement confirmation needs a server-enforced reviewed scope rather than duplicating the netting algorithm in the UI. Preserve existing financial history and permission checks.
4. Run Playwright only for application regression checks. Distinct local build directories/ports prevent agents corrupting one another's Next output. Use the exact Node 22 and pnpm 9 runtime, not the shell default.
5. Required hosted suites fail visibly when unconfigured. Strengthen existing GitHub workflows, preserve trusted event/target/revision and protected environment checks, and leave external operations for explicit authority.

## Risks / Trade-offs

- Concurrent shared-file edits → record owners before dispatch, root alone integrates commits, reviewers receive a bounded package.
- UI promises outpace backend guarantees → define settlement preview/confirmation and leave interfaces before affected UI work.
- Existing legal information is missing → reuse approved existing content only; report exact missing owner input rather than fabricate policy text.
- Human/device/provider evidence unavailable locally → complete executable local work and clearly retain external gates as open.

## Migration Plan

No data migration is planned for the UX changes. Review and verify the isolated candidate, then hand off the exact branch and external prerequisites. Existing release/database workflow remains responsible for any later authorized migration and deployment.
