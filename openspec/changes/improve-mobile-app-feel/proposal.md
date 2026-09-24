## Why

WG pages currently return to loading placeholders during ordinary tab navigation, while common actions often wait for the server before the interface responds. The handset app should retain useful household context between visits and make its main actions fast to reach and easy to confirm.

## Changes

- Add an in-memory stale-while-revalidate cache for WG page reads, including focus refresh and local cache updates.
- Add optimistic updates with rollback and feedback for chore completion, expense, subscription, calendar, and reminder actions.
- Give WG subpages a shared loading layout, route prefetch, and short reduced-motion-aware navigation feedback.
- Add immediate touch feedback to shared buttons and tappable rows/cards.
- Place one existing primary action within thumb reach on each in-scope WG page; lead the expenses view with the balance and settlement action.

## Capabilities

### New Capabilities

- `wg-mobile-interactions`: Cached WG reads, responsive action feedback, navigation continuity, and thumb-reachable primary actions on handset layouts.

### Modified Capabilities

None.

## Impact

- `apps/web/src/core/hooks`, the nine WG page routes, WG layout/navigation, shared UI primitives, and the WG design contract.
- No API, database, offline-queue, or dependency changes.
