## Context

This plan starts from main `fd92cb299db50a7c51c2feb1f8a1469df4b845e5`, after #424/#425/#427/#429. The reference branch is `d670acb14a41039f1a3ea221c542280acf62cc8d`. It is a design reference, not a merge source: its inherited application files predate fixes now on main.

Current `WG_SECTIONS` owns the primary/segment grouping in both WG and public navigation. Start has personalized task primitives and a safe completion flow, but still mixes other members' chores into its personal section. Existing dashboard, events, unread-count, cached-fetch, Berlin-day, debt-reduction, and rotation helpers cover the required behavior. The current settings tabs and row-level chore actions are already visible and reachable.

Read `docs/brand/design-language.md` and relevant Brandbook chapters 10, 11, and 15 before visual implementation. The isolated planning worktree has no generated `graphify-out/graph.json`; prior code orientation used the existing repository graph. Generate/update it only as appropriate after application changes, not as a planning dependency.

## Goals / Non-Goals

**Goals:** Selectively restore the useful overview behavior; preserve current release fixes and discoverability; make empty/loading/error states honest; produce fresh phone/theme evidence on one exact implementation candidate.

**Non-Goals:** The old settings list/detail rewrite, a second generic Putzplan thumb action, header search, renamed Ausgaben, new endpoints or dependencies, account deletion work, or replacement of current ChatView/cache/idempotency/financial-read internals.

## Decisions

### 1. Change navigation in its existing source of truth

Move only the Kalender entry from Haushalt to Austausch in `components/app/navigation.ts`. Keep Start/Haushalt/Finanzen/Austausch and every route slug. This gives a 3/2/3 sibling layout that is easier to fit at 320px. Both the public and authenticated shell must derive the same grouping rather than acquiring a second navigation configuration.

Use `SubNav.tsx` for inline muted, monospaced counts with descriptive accessible meaning. Restrict counts to existing actionable sources: open shopping, own due/overdue chores, due recurring expenses, and unread chat. Do not invent a count for balances, Vorräte, or Kalender. At 320px, compact icon treatment may remain as on main; route labels and 44px hit areas take priority over decorative badges. A visible 99+ must expose the exact number to assistive technology.

### 2. Share reads without changing the cache engine

Use the existing `useCachedFetch` implementation and its member-scoped keys. A narrowly scoped count/read helper may be introduced, but not a new state framework. Start and segment consumers should share the same dashboard cache; there must be one intentional refresh/poll owner per resource, not one interval per subscriber. Keep polling paused when hidden and reconcile after focus/visibility changes.

The current page can supply a live count from its own visible collection so successful, reverted, and queued mutations remain consistent immediately. On authoritative refresh, shared counts reconcile to server data. Represent an unknown count as unknown, not `?? 0`; prior cached data may remain visible with a stale/unavailable indication. A successful zero hides the badge without implying that a failed read succeeded.

Do not port the old `useChatUnread` pathname effect: visiting `/chat` does not establish that a read acknowledgement succeeded. Use the unread endpoint and refresh/invalidation following the existing confirmed read flow. Preserve current ChatView behavior; no optimistic whole-chat read reset is part of this change.

### 3. Extend the existing Home model and retain its mutation path

Port the personal filtering and settlement-row idea into `core/reads/dashboard-insights.ts`; retain main's loading/error handling and completion request refs/keys. Use the existing debt-reduction helper on the already validated dashboard balances so counterparties and amounts match Ausgaben. Row identities must include the relevant entities and currency; the old `kind + href` key collides for multiple settlement rows sharing the Ausgaben destination.

"Für dich" contains own chores and personal requests/settlements. Shared shopping and recurring-cost notices may remain in this section only with explicit shared-WG context in their wording, rather than falsely assigning them to the current member. Other members' chores belong in the agenda. Existing own tasks remain reachable; the port must not silently truncate meaningful items when preview limits apply.

The new personal settlement rows and weekly agenda replace the redundant Home summary tiles. Empty financial state remains neutral and factual; error state must not become "Alles ausgeglichen". Keep the visible search link outside news and retain current default-open "Neu in deiner WG". Keep Start's onboarding and current actual mutation implementation.

### 4. Make the weekly label and time range agree

Retain the requested "Diese Woche" heading with the current Berlin calendar week, not the old rolling seven-day range. The forward-looking agenda covers today through Sunday, plus a clearly separate overdue group for older outstanding household chores. Current-member chores remain in "Für dich" instead of appearing twice. Events include the applicable all-day and recurring occurrences using existing event expansion.

Build day keys/bounds from `core/utils/berlin-day.ts` and the existing event helpers. Do not use browser-local timezone assumptions or `N * MS_PER_DAY` to advance Berlin calendar boundaries across DST. The day/range key must update at Berlin midnight and when a stale/background tab resumes; do not freeze it in `useMemo([])`. Use a bounded midnight timer or the existing visible refresh tick, with an immediate day check on resume, rather than introducing a general scheduling layer.

Reuse the existing events API. Track its status independently from dashboard/chores: loading events must not render a confirmed empty agenda; failed events must show a retry/stale indication while available chores can remain. Refresh both relevant sources coherently. Keep initial previews bounded with explicit expansion/navigation for the remainder; the existing Kalender already includes chore occurrences, so its destination remains appropriate when labeling the combined list accurately.

### 5. Add rotation context and expose one existing financial link

In `features/chores/components/ChoreRow.tsx`, show current assignee plus next predicted assignee. Calculate with the existing `chooseNextAvailableMember` inputs from the current Putzplan: active roster, absences, current assignee, and current chores. Use the same value for row context and confirmation where appropriate; do not fork the algorithm. Preserve the existing row action, named confirmation, all pending guards, offline enqueue, and retry keys.

Move only the existing Erinnerungen link in `components/wg/DebtSummary.tsx` outside collapsed balance details. Preserve #424's "Alle Salden" wording and removed duplicate add-expense action. Do not import the old DebtSummary file wholesale.

### 6. Port only the minimum hunks and protect known corrections

Primary implementation files are `components/app/navigation.ts`, `components/wg/SubNav.tsx`, `app/wg/[code]/layout.tsx`, `app/wg/[code]/page.tsx`, `core/reads/dashboard-insights.ts`, `app/wg/[code]/putzen/page.tsx`, `features/chores/components/ChoreRow.tsx`, and `components/wg/DebtSummary.tsx`. A scoped count hook/tab-render helper and minimal live-count wiring in Einkauf/Abos can be added only where required by this contract.

Do not replace `core/hooks/useCachedFetch.ts`, `core/reads/dashboard-data.ts`, ChatView, notification/settings components, or mutation handlers with their old-branch versions. Specifically preserve financial reads failing closed, absence-cache updates, visible loading headers from #423, mutation key reuse after uncertain outcomes, #425 toast stacking, #427 legal links, and #429 provider availability.

The existing settings tabs and anchors remain. The old generic Putzplan thumb action must not return: it duplicates row actions and can target an unnamed or foreign task. Other existing thumb actions remain unchanged.

## Workflow and ownership

The root implementer owns integration and evidence. Keep one writer per overlapping Home, layout, and SubNav file. These are dependent nodes rather than independent competing implementations:

| Node | Inputs | Output | Completion check |
| --- | --- | --- | --- |
| Model | Current dashboard/event/debt/rotation contracts | Personal and week derivations | Deterministic dates, currencies, ownership, and row-key tests |
| Navigation/read sharing | Model sources and current cache | Grouping/counts without new cache engine | Route, count-state, read-ack, and request-count tests |
| View integration | Model and count contracts | Home, row context, visible reminders | UI behavior and unchanged mutation regression checks |
| Phone/theme evidence | Integrated exact candidate | 320/390 light/dark captures and interaction results | No overflow, accessible controls, honest state displays |
| Independent review | Final diff and all evidence | Bounded findings/fixes | Required local gates and final acceptance verified |

A failed test returns to its owning node. Do not compensate for a data regression by changing copy to conceal it or weakening tests. Existing historical screenshots and checked tasks on the old branch are not current evidence.

## Risks / Trade-offs

- [Full dashboard reads on non-Home pages cost more] -> Share the member-scoped cache, avoid duplicate poll owners, and inspect network request counts; no new aggregate endpoint is justified by this port alone.
- [Long names/counts crowd segments] -> Favor labels and touch areas, use bounded visual counts, and verify the exact 320px layout in both themes.
- [Date/timezone drift gives misleading weekly context] -> Explicit Berlin week/day keys, midnight refresh, DST/year-boundary tests, and correct all-day handling.
- [Rotation changes concurrently on the server] -> Treat row text as a current prediction, use the existing authoritative completion result, and reconcile afterward.
- [Selective port collides with ongoing account deletion] -> Keep settings/access/account code out of scope and integrate from the current main base, not the old branch's broad ancestry.

## Migration Plan

No database or dependency migration is required. Implement as a focused branch on the specified main base, validate model and request behavior, then run fixture browser checks in light/dark at 320/390px plus the existing wider-layout regression checks. Use Node 22/pnpm 9, run required local gates and `graphify update .` after code changes, obtain independent review, and report hosted evidence separately on the final candidate SHA. A rollback reverts this UI/model change without altering stored data or restoring old mutation code.

## Evidence limits

This is a code-grounded plan. No application code, deployment, live user data, or fresh browser screenshots were produced during planning. The isolated worktree and artifact validation establish planning readiness only.
