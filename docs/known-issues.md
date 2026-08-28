# Known issues

Curated list, replaces the auto-generated `BUGS.md` bug-hunt log. Add entries
by hand; don't let this regrow into a churn log.

## Open

- **Search-highlight offsets drift on length-changing lowercase.**
  `apps/web/src/lib/wg/search.ts:138-152` (moved from `lib/search.ts`) —
  `highlightSearchMatch` finds the match index in a locale-lowercased copy of
  the string but slices the original using the original-case query length; a
  locale lowercase conversion that changes length (e.g. Turkish İ→i̇) shifts
  the highlight out of place.

## Accepted limitations (won't fix without more scope)

- **Legacy recurring-expense/chore anchors stay drifted.** Rows that already
  clamped to a month-end day before the anchor-based fix (`anchor_at` column)
  keep drifting on their current day. Repair needs a backfill with the
  original day re-entered by the user — no way to recover it from the data
  alone.
- **Offline queue has no cross-tab lock.** `localStorage`-backed queue
  (`lib/wg/offline-client.ts`) is correct for a single tab; two tabs open at
  once get no synchronization at all — there is no `storage`-event listener
  anywhere in the codebase, so a second tab only sees another tab's write on
  its own next read (enqueue, sync, or page load), not a real lock.
