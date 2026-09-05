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
- The orchestrator manages assignments, integration, plan state and push. Following the user's cost-saving direction, OpenCode performs the bulk of implementation with the live-verified `opencode/muse-spark-1.3-contributor-free` model and `xhigh` variant. Luna finishes the shared foundation and later performs actual browser reviews. A Terra medium supervisor coordinates the free workers.
- Maximum useful source parallelism is six independently owned OpenCode areas, with at most one child-agent level. Pin all workers to the free model with no paid fallback and restrict child tasks through task-local configuration where supported. If native task limits are unavailable, use at most six separately pinned CLI peers with further delegation disabled. Do not claim prompt-only limits are enforced by the runtime.

## Ownership

| Owner | Exclusive edit scope |
| --- | --- |
| Foundation (Luna) | Package/lock/UI build config, `apps/web/components.json`, `src/components/ui/**`, `src/shared/globals.css`, `src/app/layout.tsx`, shared theme provider and `cn`, shared install/PWA presentation, generic WG feedback primitives (`BackLink`, `LoadErrorBanner`, `ActionNoticeBanner`, `ImageUploader`) |
| Shell and entry (OpenCode) | `src/app/wg/[code]/layout.tsx`, `NavItem`, `SubNav`, `PageHeaderActions`, `components/wg/dashboard/**`, WG home, `components/entry/**`, `components/neu/**`, `components/auth/**`, public root/entry, `app/neu/**`, `app/auth/reset/**`, `app/entdecken/**`, app privacy presentation, new `components/app/**` |
| Finance (OpenCode) | Expense presentation components, expense/abos/mahnungen/import routes, `DebtSummary`, `DebtRow`, `PayPalPaymentButton`, `RemindButton`, `ReminderHistory`, `Abo*` presentation components |
| Household (OpenCode) | Shopping/inventory/chores/events presentation components and Einkauf/Vorräte/Putzen/Kalender routes |
| Communication (OpenCode) | Chat/Pinnwand presentation components and corresponding pages |
| Support (OpenCode) | Search and activity pages, offline page/client, not-found/global/route-error/loading presentation, `WgRouteErrorBoundary`. The existing `components/wg/dashboard/ActivityFeed.tsx` stays exclusively with Shell. |
| Settings (OpenCode) | Settings route, `components/wg/einstellungen/**`, `MemberDeactivateDialog`, `ShareWgCard`, `OfflineBanner`, `OfflineQueueNotice` |
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

Shared Foundation and all feature slices are implemented: official Base-Nova/Neutral/Lucide components and messaging primitives, Tailwind 4/PostCSS, Inter typography, Animate UI Checkbox/Switch/Collapsible, reduced-motion configuration, phone shell and all existing route surfaces. See `docs/mobile-redesign-components.md` for literal consumer APIs.

The four initial Luna feature workers stopped before source edits and their scopes were transferred. Six OpenCode peer processes were then independently observed with the explicit free-model and `xhigh` flags, one per source area. Each peer has further task delegation disabled; this is bounded peer execution, not a claim about an undocumented native OpenCode concurrency flag. The supervisor records session evidence in `docs/mobile-redesign-opencode.md`.

Legacy UI bridges remain only where active consumers still require their unchanged safety/behavior contracts. The final source review checked consumers before retaining them; no unused bridge was removed speculatively.

Support, Settings and the shared install/feedback surfaces are implemented and covered by the final gates. The original public APIs of the remaining shared wrappers are preserved. Human participant research, hosted provider delivery and real-device Safari/Android coverage remain intentionally outside this branch review.

### Final verification evidence

- Node 22.23.2: root lint, web lint/feature boundaries, typecheck, production build, bundle budget, analytics privacy and `git diff --check` passed.
- Full fixture browser suite: 204 passed, 20 skipped for unavailable live/provider-auth prerequisites, 0 failed.
- Focused browser suites: Chores 35/35, Finance/Import 39/39, Settings Access 22/22, Shopping Actions 15/15, Shopping Recovery 9/9, Pinnwand 28/28, Search 7/7, Offline 5/5 and Luna shell/chat smoke 3/3.
- Local mobile runtime review covered 390x844 and 320x844 Light, 390x844 Dark and reduced motion; all checked routes rendered and document overflow was 0px. Evidence and limitations are in `docs/mobile-redesign-luna-browser-review-final.md`.
- No merge, deployment, payment, invitation or production-data mutation was performed.

### Free-tier limit and ownership transfer

Model-routing correction from the user: routine implementation and ordinary coordination use Luna High; checks, reviews and evidence gathering use Terra Medium; escalate genuinely difficult architecture or unresolved problems to Sol, and reserve Astra for exceptional complexity. Do not spend Astra context on routine status polling, source inventories or ordinary implementation. All currently resumed source owners are Luna High.

OpenCode subsequently reported `Free usage exceeded` for all five remaining active sessions. The orchestrator aborted those exact sessions and verified the local server's session status was `{}`. No subscription, paid OpenCode fallback, alternate account, limit bypass or automatic retry remains active.

Under the already authorized Luna workflow, Shell/Entry, Finance, Household and Communication finished the existing partial source work. The Foundation Luna owner finished the install prompt/button and legacy ConfirmDialog/DeleteConfirmButton/EmptyState/Toast/styles with unchanged public APIs. Support and Settings were then verified through the applicable fixture and browser gates. The user was informed about the OpenCode limit; no paid fallback was used. All original file ownership boundaries still apply.
