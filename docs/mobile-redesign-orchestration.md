# ManaWG mobile redesign execution

## Approved direction — 2026-09-05

The user approved the image's organization and the redesign plan, with actual official shadcn/ui source as the visual authority (the AI image is not a pixel/style specification). Implement the complete existing phone-only app for young, routine smartphone users. Use Nova / Neutral / Inter / Lucide, actual shadcn primitives, and real Animate UI integration. The four destinations Start / Haushalt / Finanzen / Austausch are approved for implementation review. Preserve all feature, account, financial, permission, draft and offline contracts. No marketing site work or desktop layout.

The user now explicitly authorizes implementation first, verification afterwards, delegated work, Luna browser click-throughs and pushing a new GitHub branch. Do not run tests-first or require another prototype/navigation approval. Real participant testing and release approval are later product activities and must not be misrepresented as completed by AI reviewers. Do not deploy, merge to main, change production data, send invitations or execute real payments.

## Workspace and verification

- Workspace: `/Users/abu/Company/manawg-app-mobile-redesign`.
- Branch: `codex/mobile-shadcn-redesign-20260905`, from fetched `origin/main` at `8f845cd4efa1d7241d33a3997991a9c9c651ac22`.
- All agents write directly to this shared isolated worktree, in their owned paths only. Never reset or discard another agent's edits. No worker commits, pushes, branch changes or lockfile writes except the foundation owner.
- Toolchain: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; Node 22.23.2, pnpm 9.
- Implementation first; final lint/typecheck/build/Playwright and actual Luna browser reviews follow. Fix regressions before push. Local fixture evidence is not live-provider delivery proof.
- The orchestrator manages assignments, integration, plan state and push. Luna agents perform source implementation and browser interactions. OpenCode CLI uses `opencode/muse-spark-1.3-contributor-free` after a live model check.

## Ownership

| Owner | Exclusive edit scope |
| --- | --- |
| Foundation (Luna) | Package/lock/UI build config, `apps/web/components.json`, `src/components/ui/**`, `src/shared/globals.css`, `src/app/layout.tsx`, shared theme provider and `cn`, shared install/PWA presentation, generic WG feedback primitives (`BackLink`, `LoadErrorBanner`, `ActionNoticeBanner`, `ImageUploader`) |
| Shell and entry (Luna) | `src/app/wg/[code]/layout.tsx`, `NavItem`, `SubNav`, `PageHeaderActions`, `components/wg/dashboard/**`, WG home, `components/entry/**`, `components/neu/**`, `components/auth/**`, public root/entry, `app/neu/**`, `app/auth/reset/**`, `app/entdecken/**`, app privacy presentation, new `components/app/**` |
| Finance (Luna) | Expense presentation components, expense/abos/mahnungen/import routes, `DebtSummary`, `DebtRow`, `PayPalPaymentButton`, `RemindButton`, `ReminderHistory`, `Abo*` presentation components |
| Household (Luna) | Shopping/inventory/chores/events presentation components and Einkauf/Vorräte/Putzen/Kalender routes |
| Communication (Luna) | Chat/Pinnwand presentation components and corresponding pages |
| OpenCode worker, supervised by Terra | Search and activity pages, offline page/client, not-found/global/route-error presentation only |
| Settings (Luna, second wave) | Settings route, `components/wg/einstellungen/**`, `MemberDeactivateDialog`, `ShareWgCard`, `OfflineBanner`, `OfflineQueueNotice` |
| Verification team (later) | Existing E2E tests and evidence; source fixes assigned back to the owner or explicitly transferred |

All paths above are under `apps/web/` unless noted. Domain functions, API routes, authentication guards and stored data formats are read-only unless the orchestrator explicitly resolves a necessary in-scope adjustment. Workers request additional shared primitives from Foundation, never install their own versions or overwrite its files. Generated shadcn source may be added only by Foundation to avoid package-manager races.

## Shared visual contract

- Use `@/components/ui/<component>` and `@/shared/lib/cn`; Foundation publishes availability before consumers depend on it.
- Inspect actual generated component APIs. Base UI and Animate UI are not identical; do not assume Radix `asChild` APIs. Keep wrappers shallow and purposeful.
- Semantic classes (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`) express the chosen upstream theme. Do not carry old blue/beige palettes or custom dashboard card styling forward.
- Compact phone layouts, touch-friendly controls, 16px editable text, readable labels, safe areas, bottom navigation, inline decision context, short drawers and full-height editors where needed. No forced tutorials for ordinary phone interactions.
- Keep existing financial and offline meaning. Screens use actual data. Empty states do not fabricate sample residents or activity. Do not show a successful save for a queued/failed operation.
- No tests, browser sessions, full builds, graph updates or screenshot loops during parallel implementation. Report completed edits and uncertainties; the orchestrator starts verification after integration.

## Progress

Execution started. No implementation or verification gate is marked complete yet.
