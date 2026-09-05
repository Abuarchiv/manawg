# Finance source handoff — 2026-09-05

Status: the main Finance presentation migration is implemented. The import route error boundary now uses the installed shadcn Alert and Button primitives, with its missing closing JSX container repaired. No technical or visual gate has run, and this report does not claim verified completion.

## Changed source paths

All paths below are relative to `apps/web/src/`.

- `app/wg/[code]/ausgaben/page.tsx`
- `app/wg/[code]/abos/page.tsx`
- `app/wg/[code]/mahnungen/page.tsx`
- `app/wg/[code]/import/page.tsx`
- `app/wg/[code]/import/error.tsx`
- `features/expenses/components/ausgaben/AusgabenHeader.tsx` — earlier OpenCode edit retained
- `features/expenses/components/ausgaben/ExpenseFormSection.tsx`
- `features/expenses/components/ausgaben/ExpenseRow.tsx`
- `features/expenses/components/ausgaben/ExpensesSkeleton.tsx`
- `features/expenses/components/ausgaben/ManualSplitSummary.tsx`
- `features/expenses/components/ausgaben/RecurringExpensesSection.tsx`
- `features/expenses/components/ausgaben/TextField.tsx`
- `features/expenses/components/ausgaben/SplitReview.tsx` — new shared Finance presentation
- `features/expenses/components/import/ImportSourcePicker.tsx`
- `features/expenses/components/import/ImportMemberMapping.tsx`
- `features/expenses/components/import/ImportPreviewTable.tsx`
- `features/expenses/components/import/ImportProgress.tsx`
- `features/expenses/components/import/ImportWizard.tsx`
- `components/wg/DebtSummary.tsx`
- `components/wg/DebtRow.tsx`
- `components/wg/PayPalPaymentButton.tsx`
- `components/wg/RemindButton.tsx`
- `components/wg/ReminderHistory.tsx`
- `components/wg/AboCreateModal.tsx`
- `components/wg/AboEditModal.tsx`
- `components/wg/AboForm.tsx`
- `components/wg/AboModalShell.tsx`
- `components/wg/AboPausedBadge.tsx`
- `components/wg/AboRow.tsx`
- `components/wg/AbosList.tsx`

## Implemented presentation

- Official installed Base UI shadcn components, native variants, semantic tokens, Base `render` composition and array-valued ToggleGroups.
- Full-height expense Dialog with separate scrolling fields/actions, visible amount and payer, equal/manual participant review from the same existing split function and rotation offset used by submission. Existing manual-remainder calculation retained.
- Expense cancel offers keep, explicit discard, or continue. Keep hides the editor without resetting its current data; the existing draft hook remains responsible for storage. API/conflict/offline notices are also visible inside the editor.
- Actual Animate UI collapsible panels for receipts, recurrence and subscription detail; actual Animate UI switches for subscription pause and checkboxes for import selections.
- Expense entries are visible directly, with details, receipt access, edit/remove actions and explicit per-share payment recording/reopening confirmations.
- Personal balance in plain German, all member balances, recurring links/filter/deep-link targets and a visible import destination.
- Settlement review shows the loaded whole direct shares supported by the existing batch endpoint, their dates and amounts. It identifies unsupported remainder and distinguishes recording a past payment from PayPal. Existing request bodies and API handlers remain unchanged.
- PayPal SDK/order/capture callbacks retained; completion still requires the existing confirmed COMPLETED response. Error copy does not claim payment success.
- Subscription active/paused/all filters, recurrence/date/payer/manual/equal fields, next dates and pause/edit/delete retained. Save errors are visible inside the editor. Closing requires an explicit discard choice; values remain while continuing.
- Subscription rows retain the interval and now explicitly label the formatted next due date as `nächste Fälligkeit:` for the existing E2E contract.
- Reminder debt context, oldest debt age, cooldown, opt-out/error/sent paths and history retained.
- Import source selection, file/text/OCR editing, member mapping, per-entry selection and splits, duplicate policy, review-before-commit, real result counts and item errors retained. Pending commit controls are disabled. Switching source or leaving through the return control warns before discarding entered data.

## Open items and limits

1. Settlement preview follows the current backend's oldest-first whole-share selection using loaded records. The API accepts only member pairs, not a reviewed record set/version. It cannot guarantee that concurrently changed records match a frozen review. UI discloses this and uses the server's returned amounts/counts; strict transactional preview binding requires an API/domain owner and is not implemented here.
2. Existing draft storage/controller semantics are unchanged: expense input persists through the existing hook, while Abo/import values remain in component state and explicit cancellation protects the controls added here. No new persistence or browser-history interception was added. Existing expense draft restoration does not persist edit identity.
3. Receipt upload and its preview/offline handling remain owned by Foundation's `ImageUploader`. Its existing remaining legacy presentation is outside Finance ownership.
4. Keyboard/safe-area layout, dialog focus and nested confirmations, narrow-screen reflow, reduced motion, Base UI type compatibility, financial fixture parity and provider mocks all need the deferred integration verification. No live payment or reminder was executed.

## Verification and ownership

Only source reads, scoped diffs/searches, focused Biome formatting and apply_patch edits were performed. Terra identified the unclosed outer JSX `div`; the missing closing tag is now present. The focused Finance Biome check passed for 35 files with no remaining diagnostics. No tests, full typecheck, full lint, build, browser, graph update, dependency installation, commit, push or deploy was run by this Finance execution. Business calculations, parsers, service/API/auth/payment guards and offline storage formats outside the presentation remain untouched. Existing concurrent edits were preserved. No agent or background command was started; no Finance command remains running.
