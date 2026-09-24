## Why

The old `feat/app-restructure-20260923` branch contains useful daily-overview ideas that are still missing from current main, but also predates important chat, financial-read, cache, retry, and UI corrections. Porting a narrow set of view/model changes makes personal tasks and household activity easier to discover without undoing those fixes.

## What Changes

- Keep the four primary destinations and visible labeled segments; move Kalender to Austausch and add truthful actionable counts.
- Make Start distinguish personal items under "Für dich" from a correctly dated weekly agenda, with personal settlement rows that agree with Ausgaben.
- Show the next predicted assignee beside each chore, using the existing server-aligned rotation rules.
- Expose the existing Erinnerungen link outside collapsed balance details.
- Preserve loading, confirmed-zero, error, and stale-data distinctions and verify the changed views at 320/390px in light and dark mode.

## Capabilities

### New Capabilities

- `daily-wg-overview`: Discoverable section navigation and accurate personal, weekly, financial, and chore-rotation context for WG members.

### Modified Capabilities

None. No published main specification currently defines this capability under `openspec/specs/`.

## Impact

The WG navigation model, segment component, layout/count consumers, Start page and pure overview model, Putzplan row rendering, and balance-card link placement. Reuse existing dashboard, events, unread-count, and mutation APIs; no database, API-contract, or dependency change is planned. Existing public navigation and all deep links remain valid.

## Non-goals

No whole-branch merge or wholesale file replacement from `d670acb`; no settings list/detail rewrite; no duplicate generic Putzplan thumb action; no navigation renaming of "Ausgaben"; no ChatView, cache-engine, mutation-idempotency, financial-query, legal-link, Auth-provider, or account-deletion redesign. Preserve main's fixes through #424, #425, #427, and #429.
