## Context

The WG pages already use `apiFetch`, local form drafts, idempotency keys, and offline queues. The cache therefore applies only to successful reads; mutation requests and their queue behavior remain page-owned.

## Goals / Non-Goals

**Goals:** Keep server-backed reads coherent across WG routes, make requested actions feel immediate without inventing server-owned financial or chore state, and place the existing page actions above the measured bottom navigation.

**Non-Goals:** Persistent/browser-storage caching, API or schema changes, desktop/tablet layouts, new dependencies, or changes to settlement authorization and offline mutation contracts.

## Decisions

1. Add one client hook backed by a module-level map keyed by request URL. It stores successful `apiFetch` data, shares in-flight requests, revalidates on mount and window focus, and exposes `setData`/`mutate`. Failed refreshes keep stale data visible. Cache state stays in memory and does not replace offline drafts or queues.
2. Migrate only GET/read paths in the nine requested routes. Keep each route's existing display state, validation, draft restoration, polling, and offline synchronization, feeding successful cached reads into those flows.
3. Apply optimistic state at the page's existing mutation boundary. Use the server response for authoritative values; when an action is queued offline, preserve the existing queue message/state instead of presenting it as synchronized success.
4. Use the WG segment's existing `loading.tsx` for a generic page skeleton and a WG `template.tsx` for a 120 ms opacity transition. Navigation links explicitly request Next.js prefetch. Reduced motion skips the transition.
5. Add the requested 80 ms active scale to the shared button primitive and semantic tappable rows/cards. Preserve 44 px touch targets; reduced motion disables the transform.
6. Reuse existing page actions in a shared fixed action slot above `--app-nav-height`, with matching content clearance. Put the expense balance/settlement summary before the expense list. The activity page's existing refresh control is its primary page action.
7. The design contract currently says no button scaling or page entrance animation. This task's explicit request authorizes only these bounded exceptions: an 80 ms pressed scale and a 120 ms opacity-only route transition. There is no slide, bounce, artificial delay, or change to the 1200 ms loader timing.

## Risks / Trade-offs

- A module cache can briefly show stale data after a route revisit → revalidate on every mount and focus, preserve errors, and never persist the cache.
- Optimistic updates can conflict with concurrently changed server data → reconcile from successful responses and restore the captured prior state on failure.
- A fixed action can cover content or the bottom navigation → reserve page space and position it from the measured navigation height plus safe-area spacing.
- Cache and action state can regress offline recovery → leave queue/draft modules and mutation API paths unchanged, and verify existing offline flows.

## Migration Plan

No persisted data changes. The change can be rolled back by reverting its five commits; no cache migration or server deployment is required.
