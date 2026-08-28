# manawg architecture design

Status: proposed, awaiting user review. Written after an 8-way parallel audit
of every feature area (Pinnwand, Ausgaben, Putzen, Chat, Einstellungen,
Dashboard/Events, Import, cross-cutting API/auth layer) plus the file-size
inventory below. Phase 0 (all 6 confirmed bugs) is done — see `git log` for
the individual commits, each typechecked/linted/tested before landing. Phases
1-3 are proposed, not started.

## Why this document exists

The app works and is reasonably well-tested (1381+ passing tests, green
typecheck/lint), but it grew by accretion: every feature area independently
reinvented the same handful of patterns (list-load-with-offline-sync,
optimistic-update-with-rollback, stale-404-recovery, error-message tables,
pending/error/message state machines, popover-dismiss). The result is 8
page-level "god components" (757–1108 lines each) and a handful of real bugs
that only exist *because* the patterns were reimplemented independently
instead of shared — a fix applied to one copy doesn't propagate to its
siblings.

This is not a rewrite. Every proposal below is: extract what already exists
into a shared module, without changing behavior, verified by the existing
test suite plus new regression tests for the bugs found along the way.

## File-size inventory (worst offenders)

| File | Lines |
|---|---|
| `app/wg/[code]/ausgaben/page.tsx` | 1108 |
| `app/wg/[code]/putzen/page.tsx` | 978 |
| `app/wg/[code]/pinnwand/page.tsx` | 893 |
| `app/wg/[code]/page.tsx` (dashboard) | 757 |
| `lib/wg/offline-queue.ts` | 727 |
| `components/wg/pinnwand/AnnouncementCard.tsx` | 712 |
| `app/wg/[code]/einkauf/page.tsx` | 675 |
| `lib/wg/activity.ts` | 616 |
| `lib/wg/dashboard-data.ts` | 559 |
| `components/wg/einstellungen/AccessTab.tsx` | 555 |
| `lib/wg/import-parsers.ts` | 546 |

## Confirmed bugs (real, verified against current code)

Ranked by user-facing impact. Each gets its own tightly-scoped fix — no
bundling multiple bugs into one commit.

1. **Chat admin-delete button never renders for admins.**
   `chat-pure.ts` `canDeleteMessage` checks `member.role === 'admin'`, but
   `MessageBubble.tsx` calls it with `{ id: currentMemberId }` — `role` is
   never passed. The server (`messages/[id]/route.ts`) correctly grants
   admin override via `isVerifiedWgAdmin`, so the capability exists and
   works, the UI just never offers it. **Fix: pass the admin flag through
   to `canDeleteMessage`, or drop the dead `role` field and check
   `isVerifiedWgAdmin` result directly, matching what the server does.**

2. **AccessTab shows deactivate/reactivate to every member, not just admins.**
   Server-side gating (`members/[id]/route.ts`, hardened during the auth
   consolidation) is correct — `isOwner || isVerifiedWgAdmin`. But
   `AccessTab.tsx` renders the buttons unconditionally; a non-admin member
   sees a clickable "Ausziehen"/"Aktivieren" control that 403s on submit
   with a generic error message. **Fix: gate button rendering on the
   viewer's own admin status (already computable via the same
   `isVerifiedWgAdmin`/roster data the tab already loads).**

3. **Import commit has no double-submit protection when `skipDuplicates` is
   false.** The payload-hash check only guards against a *changed* payload
   between preview and commit — resubmitting the identical commit (double
   click, retry-after-timeout) with `skipDuplicates:false` inserts real
   duplicate expenses. **Fix: add a unique constraint /
   `onConflictDoNothing` fallback keyed on `(wgId, importDuplicateKey)`
   regardless of the `skipDuplicates` flag**, or require an idempotency key
   on the commit route like every other mutation already does.

4. **Dead `parseMentions` mention-detection path.** `chat-pure.ts`
   exports `parseMentions`; the only caller (`messages/route.ts`) discards
   its result with `void parseMentions` to dodge an unused-import lint.
   Actual mention detection is done independently (and only) in
   `ChatComposer.tsx` via regex-matching against the member roster.
   **Fix: delete the dead export, or — better — wire it up so
   `MessageBubble` actually highlights mentions, since nothing currently
   does.**

5. **Two independent recurring-template-advance call sites in
   `ausgaben/page.tsx` behave differently**: one is fire-and-forget
   (`void apiFetch(...)`, silently drops failures), the other is awaited
   and surfaces a warning toast. Same request, same failure mode, silently
   inconsistent UX. **Fix: extract one `advanceRecurringTemplate()` helper,
   always awaited.**

6. **Dashboard activity feed duplicates `activity.ts`'s feed builder with
   subtly different wording** for the same domain events (e.g. "gekauft: X"
   vs "X gekauft"). Two sources of truth for how an event is described.
   **Fixed the wording; the full pipeline consolidation
   (`dashboard-data.ts` calling `buildActivityTimeline()` instead of
   rebuilding the feed by hand) stays Phase 2** — the two builders differ
   in hrefs, per-category limits, and audit-dedup semantics, so swapping
   the whole pipeline is a real behavioral change, not a bug fix.

## Accepted-as-intentional (audited, not a bug)

- `wg/[code]/route.ts` GET returning bare WG metadata (name, share code,
  `joiningEnabled`) on auth failure — this is the "preview before joining"
  contract for the join flow. Confirmed no member roster or token leaks in
  that branch. Left as-is, but the duplicated E2E-fixture branch in the same
  file (drifted copy of `resolveE2EFixture`) is still worth consolidating in
  Phase 3 below, as a cleanliness item, not a security one.
- `events/[id]/route.ts` requiring a *verified* creator (not just any
  creator) to edit/delete their own event — stricter than some other
  owner-checks, plausible product intent, flagged for the user to confirm
  rather than assumed wrong.
- `expenses/[id]/route.ts` PATCH restricted to payer-only while DELETE
  allows payer-or-any-debtor — asymmetric but plausibly intentional (editing
  is riskier than removing); flagged for confirmation, not changed.

## Target architecture: shared primitives

The single highest-leverage change. These primitives each replace 3–5
independent hand-rolled copies found across the 8 audits:

| Primitive | Replaces copies in | New location |
|---|---|---|
| `useAsyncAction` (pending/error/message + reentrancy guard) | AccessTab (×3), NotificationSection, OfflineQueueSection | `lib/hooks/useAsyncAction.ts` |
| `useDismissableMenu` (outside-click/Escape popover dismiss) | ReactionPicker, MessageBubble, AnnouncementCard | `lib/hooks/useDismissableMenu.ts` |
| `useLoadWithOfflineSync` (request-race-guard + offline-sync-on-load) | pinnwand/ausgaben/einkauf/putzen pages | `lib/hooks/useLoadWithOfflineSync.ts` |
| `runOptimisticAction` (optimistic update + rollback-on-404) | pinnwand, ausgaben, putzen page action handlers | `lib/hooks/useOptimisticAction.ts` |
| `handleStaleEntity` (404 → remove-from-list + reload) | ausgaben (×4), putzen (×3) | `lib/wg/stale-entity-recovery.ts` |
| `buildErrorMessage(prefix, verb, error)` (table-driven error text) | expense-errors.ts (×4 near-identical fns), chore-errors.ts (×2) | `lib/wg/entity-error-message.ts` |
| `withWgRoute(handler, {limiter, key})` (auth+ratelimit+try/catch preamble) | ~40 API route handlers | `lib/wg/route-preamble.ts` (extend existing file) |
| `ConfirmGate` (arm-then-confirm two-step action) | rotate-share-code (boolean flag), delete-WG (typed confirmation) | `components/ui/ConfirmGate.tsx` |

## Target architecture: per-feature splits

Each feature area's god-component splits into hooks + a thin composition
component. Full per-file breakdown is in the individual audit notes (see
"Audit trail" below); summary:

- **Pinnwand**: `useAnnouncementList`, `useAnnouncementActions`,
  `useComposerDraft` hooks; `CommentRow` and `ConvertActions` extracted from
  `AnnouncementCard`; `workflowState` derivation moves into
  `announcement-workflow.ts`.
- **Ausgaben**: `useExpenseActions` hook pulls ~500 of 1108 lines out of
  page.tsx; recurring-advance and offline-queue-enqueue become shared
  helpers.
- **Putzen**: `useChoreLoad`, `useChoreDraft`, `useChoreActions`,
  `useAssigneeAutofill`, `useScrollToParam` hooks; the fragile
  auto-assign-touched-ref logic gets isolated with its own unit test.
- **Chat**: `useChatMessages`, `useChatMutations`, `useChatScroll`,
  `useChatReadReceipts` hooks; `ChatView` becomes composition-only.
- **Einstellungen**: `AccessTab` splits into `ShareAccessSection` /
  `MemberRosterSection` / `DangerZone`; `NotificationSection` splits into
  `PushChannelCard` / `PreferenceList` / `QuietHoursCard`;
  `OfflineQueueSection`'s per-entity-type server-check dispatcher becomes a
  plain lookup table in a `serverCheck.ts` lib file.
- **Dashboard/Events**: `useDashboardData` hook extracts fetch/poll from
  page.tsx; `EventCreateModal`/`EventEditModal` share one
  `EventFormFields` component; duplicated `serialize()`/
  `normalizeRecurrence()` in the two event routes collapse to one
  `lib/wg/event-serialize.ts`.
- **Import**: `useImportWizard` hook extracts the step state machine from
  `ImportWizard.tsx`; `import-commit.ts` calls the existing
  `validateSplits`/`insertExpenseWithSplits` from `expenses.ts` instead of
  reimplementing them (this also closes bug #3's blast radius, since the
  shared insert path can carry the fix once).
- **Cross-cutting**: `withWgRoute` wrapper rolls out to all ~40 route
  handlers; `wg/[code]/route.ts`'s drifted E2E-fixture branch switches to
  the shared `resolveE2EFixture`.

## Phased roadmap

Each phase is its own sub-project — implemented, tested, and committed
independently, so the work is never in a broken intermediate state.

- **Phase 0 — bug fixes** (done, each a single tested commit): the 6
  confirmed bugs above. Bug #6 landed in reduced scope — see its note.
- **Phase 1 — shared primitives**: extract the 8 primitives above with unit
  tests, with zero call-site changes yet (pure addition).
- **Phase 2 — per-feature adoption**: one feature area at a time, swap its
  god-component to use the Phase 1 primitives + its own extracted hooks.
  Order by file size (ausgaben → putzen → pinnwand → dashboard → chat →
  einstellungen → import), each a separate PR-sized commit series with the
  existing test suite as the regression gate.
- **Phase 3 — cross-cutting route wrapper**: roll `withWgRoute` out to all
  API routes, feature area by feature area, alongside Phase 2 so route and
  page changes for the same feature land together.

## Audit trail

Full per-feature audit findings (duplication details, file:line references)
were produced by 8 parallel subagent passes on 2026-08-21/22 and are
summarized above; the raw findings are not persisted as separate files to
avoid doc sprawl — this design doc is the durable record.

---

## Update, 2026-08-22 (afternoon): test-layer and API-layer work landed

Driven by a separate complaint — the project felt bloated, with too many
tests that were not earning their keep. The measurement backed that up, but
not quite where expected.

### What was actually wrong with the tests

Not the count. The suite's 1389 tests are mostly real. The problem was
**7,458 lines of setup before the first `describe`**, because each of the 48
route suites hand-rolled the same 8-11 `vi.mock` blocks.

The worst part was the `@/lib/db` stub: every copy transcribed the schema
into string literals (`expenses: { id: 'expenses.id', … }`) and then branched
on them (`if (table.id === 'expenses.id')`). A renamed column left every test
green while production broke. Those tests were worse than no tests: they cost
maintenance and paid back false confidence.

### What was done

| | before | after |
|---|---|---|
| Test lines | 36,903 | 34,674 |
| `vi.mock` calls | 420 | 230 |
| Setup lines before first `describe` | 7,458 | 5,286 |
| Suite wall-clock | 61s | 36s |
| Route suites on a shared harness | 0 | 48 of 48 |
| Handlers on `withWgRoute` | 0 | 63 of 78 |

- **`src/test/route-harness.ts`** — stubs only what cannot run in a unit test
  (db client, `requireMember`, notification/audit side effects). Schema tables
  and drizzle operators are the real ones now, so column drift fails the test.
  Helpers: `tableNameOf`, `columnRef`, `boundParams`, `chainOf`,
  `chainRejecting`, `queueSelects`, `authenticateAs`.
- **Vitest split into `node` / `dom` / `route` projects** — 136 of 178 suites
  were paying for a jsdom boot they never used.
- **`withWgRoute`** — the share-code preamble and the closing try/catch, which
  72 of 75 handlers repeated.
- Shared UI primitives extracted with their real adopters, not speculatively:
  `useOfflineQueueSync` (4 pages), `useDismissableMenu` (3 components),
  `lib/wg/expense-split-input.ts` (pure split building, 14 mock-free tests).

Two real defects surfaced while converting:

1. Three of the four offline pages could `setState` after unmount — only
   `ausgaben` cancelled its in-flight sync. Fixed for all four by the hook.
2. `wg/route.test.ts` generated the share code `ABC12345` and only passed
   because `isValidShareCode` was mocked to return `true`. `1` is not in the
   share-code alphabet.

### Correction to this document's original claim

The E2E fixture path was listed as "test scaffolding shipped to production".
That was wrong. It is what lets the E2E suite run without a database, it is
already centralised in `route-preamble.ts`, and CI depends on it. What was
genuinely repeated was the surrounding preamble, and that is what
`withWgRoute` absorbed.

### The god components are still open, and hook extraction will not fix them

`ausgaben` (1031), `putzen` (964), `pinnwand` (879) barely moved. Their length
is **not** mostly duplication — that was the working assumption, and it does
not survive reading them. Each page owns four entangled responsibilities:
data loading, form state, mutations, and render. The mutation handlers are
long because they genuinely handle four paths each (online, offline-enqueue,
stale-404, edit-vs-create), not because they repeat each other.

Extracting `useRecurringExpenses` or `useExpenseMutations` would mean a hook
taking ~14 dependencies — the same code, one indirection further away, and
harder to follow. That is a worse outcome, so it was not done.

The honest options, needing a decision rather than a mechanical refactor:

- **Per-page reducer.** Collapse the ~12 `useState` calls into one reducer, so
  mutations dispatch actions instead of closing over a dozen setters. The
  handlers then extract cleanly because they need one `dispatch`, not 14 refs.
- **Split by sub-feature with its own data ownership.** Recurring templates
  become their own component that loads and mutates its own list, rather than
  sharing the page's state.
- **Leave them.** They are tested and work; length alone is not a defect.

Recommendation: the reducer, starting with `ausgaben`. It is the only option
that makes the mutation handlers extractable without inventing a
14-parameter interface.
