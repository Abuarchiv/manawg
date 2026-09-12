# Product experience implementation record

Started 2026-09-04; continued 2026-09-05, Europe/Berlin.

Status: local implementation and final local validation are complete; the runtime source has independent Terra/xhigh approval with no Critical/Important actionable finding. This is not a production or resident-usability sign-off.

## Candidate and ownership

- Worktree: `/Users/abu/Company/manawg-app-product-experience`
- Branch: `codex/product-experience-20260904`
- Base: `8f845cd4efa1d7241d33a3997991a9c9c651ac22`, re-fetched and unchanged during final integration.
- Runtime source reviewed through `a464dbc`; `692e3d6` subsequently updates one existing test to respect the native leave dialog. It changes no application behavior.
- UI/UX: GPT-6 Astra, xhigh. Other implementation: GPT-5.6 Luna, max. Independent reviews: GPT-5.6 Terra, xhigh. Root coordinated ownership, integration, verification and local commits.
- The original `/Users/abu/Company/manawg-app` checkout and its planning changes were preserved. No push, deployment, provider configuration, production migration, payment or message was performed.

## Implemented experience

- New households see a useful first action; returning residents see actual current work before statistics. Empty charts no longer occupy space without information. The five primary tabs and existing meaningful content remain.
- Shopping names and roles are readable; added-by and bought-by are distinct. A purchase can open an unsaved expense with known buyer/name context and no invented amount.
- Expense shares and their consequences appear before saving. The payer's own share is identified separately from external obligations. Optional receipt controls are compact.
- Closing and reloading preserve expense drafts, edit identity/version and chore recurrence. Deleted or damaged edit metadata cannot silently create a new expense.
- Shopping, recurring and chore suggestions cannot silently replace partial/unknown drafts. Replacement is explicit; retaining an unassigned chore draft does not silently assign someone. Blocked recurring suggestions do not advance a template.
- Monthly offline creation, queue editing and replay retain their unit; exact-empty default drafts no longer block queue editing, while meaningful or unknown draft data stays protected.
- Manual settlement reviews exact supported records/amounts and distinguishes bookkeeping from an actual payment. Stale scope is rejected server-side. Success remains visible after the final debt disappears.
- Chore confirmation distinguishes provisional rotation from the server-confirmed result. Keyboard-focused payment confirmation remains above the fixed navigation without unnecessary scroll jumps.
- Self-leave reuses the existing open-balance review and guarded membership PATCH before cleanup. Failure preserves the dialog/state and allows retry. Reactivation copy names the required admin permission.
- Dashboard net balances reuse canonical accounting logic; gross paid/owed response metrics retain their established semantics.
- Account, WG, session and unsynchronized local-data wording is distinct. PayPal identifier copy makes no transfer or activation claim. Existing public legal destinations replace dead app links.

## Server and workflow integrity

- Settlement preview and confirmation share one server-owned selection rule. Exact net, record IDs and each amount are compared under the existing WG payment lock; conditional short updates roll back.
- The authenticated caller's active membership is locked and revalidated inside the transaction. Historic inactive members remain in balance computation.
- Expense/split/payment writers inspected for this change share the existing accounting lock; provider network operations remain outside database transactions.
- All settlement GET responses, including wrapper/preamble/caught errors, receive `Cache-Control: no-store`.
- Protected Preview migration/check gates the same-run browser suite. The member-auth suite and its dedicated QA configuration are explicitly required.
- Trusted event actors/ref/basic target shape are filtered before protected Preview jobs; full runtime origin and exact-main-SHA checks remain.
- Production migration requires explicit confirmation, an approved SHA and matching successful Preview evidence, plus a fresh main check at cutover. This is a point-in-time check, not an atomic freeze of GitHub or Vercel.

## Validation evidence

The exact local runtime was Node 22.23.2 and pnpm 9.0.0. The shell's default pnpm was 11; a temporary shim at `/tmp/manawg-product-tools` selected the already-installed pnpm 9 without changing the global installation.

| Check | Recorded evidence |
| --- | --- |
| Original source baseline | Lint/types/build/bundle passed; original fixture snapshot 204 passed, 20 hosted cases skipped. |
| UI targeted checks | Final wave 1: 90 passed; final built wave 2: 23 passed; no retries/skips. Includes delayed lazy-form focus and retained-draft cases. |
| Account and balance | Four browser cases and three strengthened calculation cases passed. |
| Workflow contracts | Seven local contract/wiring checks passed. These are not a GitHub/hosted execution. |
| Settlement contracts | Five behavioral calculation/parser checks passed; two actual local HTTP error/cache cases passed. No source-substring assertion is treated as executable concurrency proof. |
| Source checks on final candidate | Lint 406 files, typecheck, analytics privacy and seven feature boundaries all passed after the final production build. |
| Full fixture suite | **247 passed, 0 failed, 20 intentionally skipped hosted cases**, 3.7 minutes, zero retries, built fixture mode. Earlier obsolete consent/click-through-modal expectations were migrated without removing their remaining assertions. |
| Production build and bundle | Root final build and unchanged budgets passed: expenses **49.7 KiB/55**, chores **54.5 KiB/55**, shared **101.3 KiB/120**. Budgets were not raised. |
| Independent review | Terra closed the workflow and accounting findings, then closed the remaining UX/account findings in the whole-branch review. No Critical/Important actionable source finding remained at `a464dbc`; the required final local checks subsequently passed; external gates remain open. |
| Visual inspection | Root inspected actual fixture screenshots of dashboard, shopping, expense review, chore review and keyboard-visible settlement. This is not a test with residents or physical devices. |
| Knowledge graph / specifications | Graph regenerated: **3378 nodes, 8400 edges, 212 communities**. Nine OpenSpec changes passed strict validation. Optional SQL parser absent; SQL files were not indexed and no SQL migration changed. |

Main local logs are `/tmp/manawg-product-final-build.log`, `/tmp/manawg-product-final-fixtures-v3.log`, `/tmp/manawg-settlement-http.log`, `/tmp/astra-ux-wave2-built.log`, and the dated execution ledger under `.superpowers/sdd/2026-09-04-app-release-readiness/`. Final validation logs and source-review reports are also copied into that ledger directory’s `evidence/` folder for local retention; detailed worker records remain alongside it.

The final production build also normalized the tracked Next route-type reference to `.next/types/routes.d.ts`, replacing an old fixture-port path. The final typecheck passed with this generated reference.

Fixture-only visual examples are preserved under `/Users/abu/.codex/visualizations/2026/09/04/01a06e05-a21e-7161-81cf-b0e1adbec12f/manawg-product-experience/`; they contain test data.

## Decisions made during implementation

| Decision | Reason | Cost if the choice needs revision |
| --- | --- | --- |
| Isolate work in a sibling worktree | Protect original code/planning work and start from the current remote base | Integration/path handling remains a separate local step; code is preserved in commits |
| Use the proposed reversible UX defaults | The user authorized implementation of the prepared UX plan | Labels and hierarchy may need iteration after resident testing |
| One file owner; root stages/commits | Prevent overlapping workers from committing incomplete changes | A package waits for coordinated integration |
| Keep external/human/device gates open | Local mocks and source checks cannot establish their outcomes | Release waits for actual evidence |
| Show the payer's own share without a payment action | It is not a debt to another person; canonical accounting already excludes it | Older UI assertions needed realistic other-member fixtures |
| Retain existing last-member and completion boundaries | Avoid inventing new role/rejoin/undo semantics | Last-member prevention is UI-only; true reversal/recovery expectations require explicit product work and validation |

## Still open before production/product sign-off

See [external prerequisites](external-prerequisites.md) for exact protected configuration and operator steps. Required evidence remains:

- Hosted Preview database migration/check, direct role/RLS denial tests, full authenticated browser flows, same-revision evidence and cleanup.
- Real database concurrency and revoked-member race checks for reviewed settlement; provider sandbox validation, including the pre-existing capture-versus-balance-change policy question.
- Enabled login/confirmation/reset/SMS/provider delivery and recovery on another device; actual leave/reactivation and account-switch privacy proof.
- Real iOS/Android installation, update, offline/reconnect and notification behavior; published upload/calendar/payment integrations.
- Resident usability sessions using the [UX protocol](../superpowers/specs/2026-09-04-app-user-experience.md), including financial consequences and recovery understanding. No satisfaction rate has been measured.
- Responsible review of legal/privacy/provider/storage/leave content at the existing legal destinations; a working link does not certify the content.
- Restore drill, operational monitoring/support ownership, approved RPO/RTO and controlled production release authority. No production action is authorized or implied by this record.
