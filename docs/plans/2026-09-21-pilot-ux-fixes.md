# Pilot UX fixes — 21 September 2026

## Goal and scope

Implement the six findings and cadence explanation from
`/Users/abu/Company/ManaWG-Visuals/2026-09-20-two-week-pilot/PILOT-REPORT.md`.
The pilot simulated fourteen days with eight independent personas; it does not
establish real-user, production, payment, or native keyboard behavior.

Preserve the pre-existing dirty working tree, especially calendar/date fixes,
release work, and existing regression tests. No deployment, external writes,
schema expansion, or changes to `TASKS.md`. These are corrections to existing
flows; reuse the existing announcement resolution mechanism.

## Acceptance criteria

1. **320px / 200% layout:** Einkauf, Vorrat, and Putzplan remain readable at a
   320px CSS viewport and 32px root text in light and dark themes. No page-level
   horizontal overflow, one-character text columns, clipped labels, or lost
   controls. Controls retain accessible touch targets. Test actual viewport and
   document measurements; do not claim native Dynamic Type coverage.
2. **All-day agenda:** the shared occurrence logic includes an all-day event
   throughout its displayed local calendar day, including an evening visit.
   Multiday and recurring all-day events remain visible on each covered day,
   with tests across both Berlin DST transitions. Timed events retain their
   established behavior. Preserve existing all-day storage/edit/month fixes.
3. **Recurrence editing:** Create and Edit share a user-readable recurrence
   control and formatter. Choosing weekly in Edit produces one successful PATCH,
   preserves the event ID, and stores `FREQ=WEEKLY`. Editing an unrelated field
   must preserve an existing more complex recurrence rule.
4. **Shopping duplicates:** establish the server cause and return a defined
   conflict instead of 500 for an existing open normalized name. Show the open
   item, retain input, and offer explicit reconciliation or edited new-name
   creation. Preserve the existing unique-open-name constraint and free-text
   quantity semantics. Bought items can be created again. Verify conflict,
   case/space normalization, reconciliation, and state after reload.
5. **Multiline chat:** Enter creates a paragraph and the separate send action
   submits it. Preserve IME composition and mention-selection behavior. Verify
   two paragraphs survive submission and reload at 360px / 16px root text;
   320px / 200% is additional layout coverage, not native-keyboard proof.
6. **Resolved chore swap:** a successful chore completion visibly resolves its
   existing open swap announcement after reload. Reuse `status`, `resolvedAt`,
   and `resolvedByMemberId`; match WG, `source='chore_swap'`, and the exact chore
   source path. Perform resolution inside the existing completion transaction.
   Unrelated announcements remain open; failed completion does not resolve.
   Do not infer resolution from arbitrary reply text.

**Cadence explanation:** explain the existing first due date and stable cycle in
the chore UI. Early completion advances from the scheduled due date; late
completion advances from completion time. Copy only; do not change recurrence
math or add a cadence-setting subsystem.

## Ownership graph

| Node / owner | Inputs and exclusive implementation scope | Output / completion check |
| --- | --- | --- |
| Layout worker | Report; shopping and inventory row/form components; `ChoreRow.tsx`; relevant page layout markup | Minimal responsive changes; criterion 1 |
| Calendar worker | Report; existing calendar WIP; `features/events/events.ts`, event form/create/edit components, calendar page | Shared overlap and recurrence fixes; criteria 2–3 |
| Shopping worker | Report; shopping API route, Einkauf mutation/conflict flow, shopping error mapping | Proven error cause and recoverable duplicate flow; criterion 4 |
| Chat worker | Report; `features/chat/components/ChatComposer.tsx` | Multiline composer behavior; criterion 5 |
| Chore worker | Report; chore completion route and `ChoreForm.tsx` | Transactional swap closure and cadence copy; criterion 6 plus copy |
| Root integrator | All worker diffs, baseline dirty-state record, focused evidence | Resolve ownership overlaps, run applicable checks, update graph |
| Independent reviewer | Integrated diff and verification evidence | Scope/correctness review; explicit findings or acceptance |

The first five nodes run independently. Where a page or test file overlaps,
root assigns a single writer and integrates dependent patches; workers do not
overwrite each other's changes. Root owns shared regression files and final
evidence. The planning artifact has one writer, the scope reviewer.

Edges: baseline and accepted report → workers → root integration → independent
review → focused repairs if needed → final verification. Review findings return
to the responsible owner; root reruns affected checks after repairs. Three
failed fixes on the same issue trigger reassessment of the doubtful assumption.

## Verification and exit

Use the repository's existing tests and browser harness. Run applicable lint,
typecheck, tests, build, and E2E checks, recording their exact results. Keep
fixture/local evidence distinct from authenticated or production behavior.
After code changes, run `graphify update .`. Stop when all six criteria and the
cadence copy are verified and independent review findings are addressed, or
report the precise remaining blocker without claiming completion.
