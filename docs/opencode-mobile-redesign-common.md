# Mobile redesign worker contract

Read this contract, `docs/mobile-redesign-orchestration.md`, `docs/mobile-redesign-components.md`, and proposal/design/spec/tasks under `openspec/changes/redesign-mobile-app-with-shadcn/`. Read every assigned source file and callers before edits; inspect actual `components/ui/` and `components/animate-ui/` exports. Use only their existing APIs.

Implement presentation only: official shadcn Nova/Neutral/Inter/Lucide and actual Animate UI where useful, semantic tokens and original primitives. Compact handset-only 320/390/430 layouts, 44px targets, 16px editable text, keyboard/safe-area and accessible/reduced-motion behavior. Preserve controllers, hooks, storage, API/auth/security/data shapes, permissions, drafts, retries, direct URLs/query prefills, all state handling and financial meaning.

Edit only the invocation allowlist. No dependencies/lockfiles/config/shared UI/Animate UI/shared CSS/root layout/theme/PWA/core/domain/API/hooks/auth/security/tests/OpenSpec/orchestration edits. No delegation. Use `apply_patch`; do not test/lint/build/browser/graph/git commit-push-reset-stash-clean or perform live mutations. Report missing shared APIs; do not fake them. A concise role report is the only allowed new file.
