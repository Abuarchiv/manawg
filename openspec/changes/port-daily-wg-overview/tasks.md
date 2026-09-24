## 1. Derive accurate personal and weekly data

- [x] 1.1 Confirm the implementation base and selective diff against `fd92cb299db50a7c51c2feb1f8a1469df4b845e5`, read the current brand contract and relevant chapters, and verify no old settings/Auth/financial-query/mutation implementations enter the diff.
- [ ] 1.2 Extend the pure overview model for personal ownership, shared-context notices, and settlement rows with stable counterparty/currency identities; verify own/other chores, several counterparties, multiple currencies, and equality with Ausgaben's existing settlement calculation.
- [ ] 1.3 Add Berlin calendar-week agenda derivation with separate overdue context and no duplicate own chores; verify all-day/recurring events, Sunday/Monday, month/year boundaries, both DST transitions, and UTC/non-Berlin runtime timezones.

## 2. Port visible navigation and truthful counts

- [x] 2.1 Move Kalender to Austausch in `WG_SECTIONS` and retain all primary labels/slugs, especially Ausgaben; verify direct calendar links and both public/authenticated active navigation with all sibling segments visible.
- [x] 2.2 Add scoped shared count consumption using the existing cache and one refresh owner per resource; verify loading/error are not numeric zero, confirmed zero hides the badge, stale data is identifiable, 99+ exposes the real count, and subscriptions do not multiply poll requests.
- [ ] 2.3 Wire current-module live counts and server-confirmed chat unread refresh without changing ChatView's read semantics; verify successful/rolled-back/offline mutations reconcile counts and a failed read acknowledgement does not clear unread messages just by entering Chat.

## 3. Integrate Home while preserving existing behavior

- [ ] 3.1 Render the personal section and weekly agenda on current main's Start page, replacing redundant summary tiles but preserving onboarding, visible search, and default-open news; verify bounded previews expose remaining items and rows keep stable identity across updates.
- [ ] 3.2 Refresh the agenda range at Berlin midnight/resume and handle events independently from dashboard state; verify a loading or failed event request never displays "nothing scheduled", available chores stay usable, and cached stale data is marked appropriately.
- [ ] 3.3 Keep the current completion refs, idempotency keys, pending guards, offline behavior, and financial failure handling; run targeted network/5xx/429 retry, duplicate-completion, and unavailable-financial-data regressions against the integrated Home.

## 4. Add only the remaining targeted view improvements

- [ ] 4.1 Show current and next predicted assignee in Putzplan rows using the existing shared rotation helper and current member/absence/chore inputs; verify agreement with the authoritative algorithm, viewer-as-next wording, absent/deactivated members, and no eligible successor.
- [ ] 4.2 Move the existing Erinnerungen link outside collapsed balance details without restoring duplicate add-expense or generic chore thumb actions; verify keyboard navigation, the destination URL, and retained "Alle Salden" wording.
- [ ] 4.3 Review the final touched-file diff for protected main behavior and run relevant regression checks for absence cache, loading headers, toast stacking, settings anchors, legal links, and Auth-provider availability; confirm no settings list/detail rewrite or old cache/ChatView implementation was imported.

## 5. Prove the final phone-first candidate

- [ ] 5.1 Capture and inspect changed Home, household/finance/exchange segments, Putzplan rows, and visible reminders at 320px and 390px in light and dark mode, including long names and 99+ counts; verify no page overflow, at least 44px targets, readable labels, and unclipped keyboard focus.
- [ ] 5.2 Verify keyboard, reduced-motion, high-contrast/reduced-transparency fallbacks, and existing wider/tablet layouts; record fresh candidate-specific screenshots and interaction evidence rather than reusing old-branch captures.
- [ ] 5.3 Run Node 22/pnpm 9 lint, typecheck, unit/model tests, build, relevant fixture E2E, `git diff --check`, and `openspec validate port-daily-wg-overview --strict`; after application edits run `graphify update .`, obtain independent review, and report local versus hosted evidence separately on the exact final SHA.
