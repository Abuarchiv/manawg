# Bounded OpenCode task: mobile search, activity, offline, and errors

Work only in `/Users/abu/Company/manawg-app-mobile-redesign`.

You are implementing the approved ManaWG phone-only shadcn/ui redesign. The visual authority is the official shadcn Nova / Neutral / Inter / Lucide setup, not a legacy recolor. The audience is young, smartphone-confident WG residents. Preserve all behavior exactly: auth and authorization boundaries, account/WG scoping, financial/offline semantics, route and query deep links, search/activity filters, requests, retries, loading/error states, drafts, and return actions.

## Exact edit scope

You may edit only these existing presentation files:

- `apps/web/src/app/wg/[code]/suche/page.tsx`
- `apps/web/src/app/wg/[code]/aktivitaet/page.tsx`
- `apps/web/src/app/offline/page.tsx`
- `apps/web/src/app/offline/OfflineClient.tsx`
- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/error.tsx`
- `apps/web/src/app/wg/[code]/error.tsx`
- `apps/web/src/components/wg/WgRouteErrorBoundary.tsx` (the existing shared presentation consumed by route error wrappers)

Do not edit any other path. In particular, do not edit package files, lockfiles, `components.json`, global CSS, `src/components/ui/**`, domain/core/API/auth/offline logic, route wrappers, tests, OpenSpec files, or orchestration docs. Do not add dependencies or shared primitives.

## Required implementation

Read every scoped source file and its callers before editing. Use only actual generated primitives that Foundation has made available at `@/components/ui/` and inspect their exports before importing. The expected contract is `Button`, `Input`, `Item`, `Alert`, `Empty`, and `Badge`; if one is unavailable or has a different API, do not create/fake it or modify shared UI. Use what exists and state the missing component/API in your final output.

Replace legacy custom card/button/input presentation with original shadcn composition and semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`). Use Lucide icons. Use `Button`, `Input`, `Item`, `Alert`, `Empty`, and `Badge` where each naturally applies. Keep mobile layout compact, 44px targets and editable input text at least 16px. Preserve accessible labels, aria-live feedback, error retry, focus/keyboard behavior, and explicit recovery links.

- Search: keep its request cancellation ordering, all quick/module filters, suggestions, count, reset/clear actions, result hrefs, error retry and empty/module routes.
- Activity: keep request ordering, filtering/scoping, inbox priorities/hrefs, existing ActivityFeed behavior and prefilled empty-state deep links.
- Offline: keep membership filtering before any queue display/sync, local queue preservation, sync guards, exact queued-vs-synced/failure messages, all deep links and known-WG scoping. Never turn a queued action into a success state.
- Error pages: keep exception capture and reset/recovery behavior; do not expose error details outside development. Change only presentation to the shared shadcn visual language. Keep `global-error` valid as a document-level boundary.

Use layout classes only; do not recreate old palettes, gradients, font rules, or handcrafted component variants. Do not run tests, build, lint, browser tools, graph tools, git commit/push, deploy, or live account/payment actions. Do not use broad permission approval.

At the end, give a terse summary of edited files, behavior deliberately preserved, unavailable component contracts (if any), and commands not run.
