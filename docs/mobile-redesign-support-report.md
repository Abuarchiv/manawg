# Support role report — search / activity / offline / route states

Scope: presentation-only redesign with official shadcn Nova/Neutral/Inter/Lucide + Base UI `render` composition and semantic tokens. No controller, hook, storage, API/auth, permission, draft, retry, deep-link, or financial-meaning changes.

## Changed paths (apps/web/src)

- `app/wg/[code]/suche/page.tsx`
  - `BackLink`, `Card`+`FieldGroup`/`Field`/`FieldLabel`, `InputGroup`+`InputGroupInput`/`InputGroupAddon`/`InputGroupButton` (16px, 44px, keyboard/safe-area).
  - Quick/module filters as `Button` chips (`default`/`outline`, `rounded-full`, `aria-pressed`, 44px).
  - Results as `ItemGroup`/`Item render={<Link>}` + `ItemTitle`/`ItemDescription` + `Badge` module label; deep-link `href` unchanged.
  - Loading: `Spinner` + `Skeleton` rows + polite `output`; empty/filter-hidden states via `Empty`/`Card`; errors via existing `LoadErrorBanner` retry.
  - Preserved: `fetch /api/wg/[code]/search?q=`, `x-manawg-member-id`, `requestId` race guard, `filterSearchResults`/`filterSearchResultsByQuickFilter`, suggestions, `visibleCountLabel`, `toggleModule`/`resetFilters`/`clearSearch`.

- `app/wg/[code]/aktivitaet/page.tsx`
  - `BackLink`, refresh `Button outline icon-lg` with `Spinner`/`RotateCw` (`motion-reduce:animate-none`).
  - Inbox in `Card`+`Badge` count + `ItemGroup`/`Item render={<Link>}`; `wichtig` as `Badge destructive`.
  - Filter search via `InputGroup`; scope/kind/`Nur ich` via `Button` chips; `Separator` between groups.
  - Chronicle day dividers via `Marker separator`; rows via shared `ActivityFeed items={group.items}` (existing API only).
  - Empty/filter-empty via `Empty`; loading via `Spinner`+`Skeleton`; errors via `LoadErrorBanner`.
  - Preserved: `apiFetch /api/wg/[code]/activity`, `filterActivityItems`/`filterActivityByScope`/`groupActivityItemsByDay` with `wgBaseHref` prefix, `buildActivityInbox`, `getActivityEmptyActionHref` prefills (`desc`/`amount`, `content`/`kind`, `title`), retry/reset.

- `app/offline/OfflineClient.tsx` (`app/offline/page.tsx` unchanged wrapper)
  - Three `Card` sections, `Badge` online/offline status, `Button` sync/prüfen (44px, `Spinner` while syncing), `Alert` sync message, `ItemGroup` queue + known WGs, `Empty` for empty queue, `Separator` for overflow note.
  - Preserved exactly: `getAccountMemberships` (401→null, `account_wgs_failed`/`account_wgs_invalid`), `memberKeys`/`memberCodes` guards, `readOfflineQueue` filter, `online/offline/manawg:offline-queue` listeners, `syncNow` guards/messages, `syncOfflineActions(code,{force:true,memberId})`, `formatManualOfflineSyncResult`, `getOfflineSyncFailureMessage`, `wgHref` links (`/einstellungen#daten`, `/neu`, `/wg/[code]`), `formatOfflineAge`/`formatQueuedActionCount`.

- `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`
  - `Empty`+`EmptyMedia icon` (Lucide `House`/`TriangleAlert`)+`Button lg min-h-11`; `global-error` keeps required `<html lang="de"><body>`; `captureException` boundaries (`root`/`global`) and dev `pre` preserved; safe-area + `max-w-md`.

- `app/wg/[code]/error.tsx`, `app/wg/[code]/not-found.tsx`
  - `Card`+`Empty` composition, semantic tokens, 44px `Button`s (`Erneut versuchen` + `Link` `/` or `/neu`); `captureException boundary wg-code` and copy preserved.

- `app/wg/[code]/loading.tsx`
  - Same `CARD_KEYS`/`BAR_ROWS`, `aria-live/busy/label` preserved; raw pulse `span`s replaced with official `Skeleton` inside `Card`.

- `components/wg/WgRouteErrorBoundary.tsx`
  - Props (`error/reset/boundary/title/body`) and `useParams code` + `captureException({boundary})` preserved; presentation via `Card`+`Empty`+44px `Button`s (`Zur Übersicht` → `/wg/${code}`).

## Ownership exception

- `components/wg/dashboard/ActivityFeed.tsx` is SHELL-owned per resume instruction — no further edits made in this resume pass. An earlier pre-interruption pass had migrated it to `ItemGroup`/`Badge`/`Empty`/`Button`; that working-tree edit (if still present) is left untouched for SHELL to review/overwrite. `aktivitaet/page.tsx` consumes only its existing `ActivityFeed({items})` API.

## Missing / deferred (not in support scope)

- Verification deliberately not run: no tests, typecheck, lint, build, browser, or graph update per worker contract.
- No new shared primitives requested; `BackLink`/`LoadErrorBanner` reused as published. No missing shared APIs to report.
- Handset rules applied: `max-w-md` centered single column, 44px targets, 16px editable text, `pb-[env(safe-area-inset-bottom)]`, `motion-reduce:animate-none` on spinners, no second `MotionConfig`.
