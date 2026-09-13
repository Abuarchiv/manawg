# ManaWG full UI review — 2026-09-13

## Pre-push review

Two independent Astra high reviewers checked the uncommitted UI diff and the
critical auth/payment/offline/CI portions of the outgoing committed stack.
They found two P2 defects, both corrected before publication:

- Successful template edits now reset and close the editor, so its next submit
  cannot silently become a new expense. The success path is checked separately
  from the earlier intercepted error-path test: a local intercepted HTTP 200
  produced the success message, zero open dialogs and the normal create action.
  Only a template PATCH was dispatched. No request reached the server; the
  pre-existing local draft was restored after the probe.
- Settlement previews now share the POST parser's 50-split limit. A 51-split
  regression confirms that the first 50 are selectable and the remaining amount
  and final split remain available for the next settlement. Independent review
  also confirmed parser acceptance and scope matching.

This review is not a claim that every line in the 376-file outgoing stack was
independently audited or that production backend flows were exercised.

## Follow-up: iPhone 11 review

The owner requested a fresh review with **414×896 CSS pixels as the primary
prototype**, rather than treating the preceding review as acceptance. Three Luna
reviewers independently revisited household, exchange/settings and public entry;
the parent checked finance and integrated changes, with Astra high reviewing
the implementation decisions. Secondary width was 320px (720/740/896px heights).

Additional observed issues fixed in this pass:

- Caller-level 44px header boxes still overrode the compact button primitives.
  Home, list headers and BackLink now use 36px visible controls. Adjacent controls
  reserve 8px gaps for non-overlapping 44px hit regions. Reviewers measured zero
  visual or hit-region overlaps at 414px and 320px.
- Expanded recurring-cost cards had a full-width action plus a second action
  row. They now use a compact Erfassen/Prüfen action and an overflow menu. Edit,
  manual-entry links and deletion confirmation remain available. The menu width
  was increased in the next iteration after narrow German labels wrapped.
- Manual split editors repeated every member/amount in a second preview list.
  That list is now shown only for automatically calculated splits. Manual input,
  validation and the expense sum summary remain.
- The template editor's primary action and Enter previously created an expense.
  Its primary submit now saves the template; expense creation remains an explicit
  secondary action. Both actions were exercised with request interception:
  Enter produced `PATCH /api/wg/.../recurring-expenses`; the secondary action
  produced `POST /api/wg/.../expenses`. Both were answered locally with a test
  HTTP 400 before transmission. This verifies dispatch, not successful persistence.
- WG-code renewal now has an explicit Abbrechen control, verified without
  confirming renewal. The action pair wraps cleanly on narrow screens.
- Import text entry no longer nests an extra bordered panel around its field;
  its initial text area is 128px rather than 192px. Monthly labels are grammatical.

Fresh route coverage: all 14 WG routes, all 11 discovery modules, public Home,
authentication entry (email/SMS, create and invite intent), empty registration
and recovery validation, password-reset error, offline, privacy and not-found.
Additional states included chore absence/fairness, calendar subscription and
templates, inventory fields, existing Abo/template editors, recurring menus,
chat reply/reaction actions, and settings confirmation/cancel flows. No horizontal
overflow was found in the final 414px/320px reviews. Menu-to-dialog transitions
and focus return to the recurring action trigger were verified.

Limits remain as documented below. A synthetic valid CSV could not progress
beyond input because the fixture backend rejected preview processing; mapping,
commit and successful persistence were not claimed. One auth tab showed an
offline fallback during rebuild downtime. A separate source/harness review
confirmed network-first navigation, no `/neu` cache writes, and recovery on a
successful next navigation; `navigator.onLine` alone was not treated as server
health. Existing local drafts can reopen editors and were retained. The complete
WG-deletion confirmation was not exercised because the browser tool blocked
that entry; no workaround or destructive operation was attempted.

Lint, typecheck, production build and the existing API/model checks were rerun
for this pass. No physical iPhone 11 or Safari keyboard test is implied by the
414×896 Chrome prototype.

## Acceptance and review loop

The supplied ManaWG Brandbook v1.0 is the visual reference. Review the rendered
application, fix observed deviations, build once changes are integrated, and
repeat the affected interactions. A passing build alone is not visual evidence.

Coverage includes all 14 WG pages, public entry and discovery modules, account
entry, password recovery, offline, not-found, and available form/dialog states.
Review smartphone and tablet layouts, light/dark themes, overflow, readable type,
keyboard focus, validation, navigation, and compact component proportions.

Owners: independent Luna browser reviewers for household, finance, exchange and
support, and public discovery; Astra high reviews the shared component contract;
the parent integrates and verifies. Writers own disjoint files. Only the parent
changes viewport or rebuilds the shared preview.

## Round 1 findings

- Mobile-only overrides flatten button variants and create a size discontinuity
  at 640px. Shared input, select and input-group sizes disagree on tablets.
- Shopping changes a three-control form to a two-column grid on tablets.
- Public previews nest filled rows inside cards and repeat module/item titles.
- Offline repeats its empty queue in a large panel and lacks a semantic h1.
- Invalid password recovery displays irrelevant new-password instructions.
- Navigation labels use 11px Inter; profile metadata uses an off-scale 12.5px.
- Load errors occupy a full-width action row; reminders errors need clearer
  association with the independently loaded history or expenses.

## Evidence boundaries

Preview runs locally with fixture data and no configured database. Successful
authentication, persisted writes, payments, email/SMS/push delivery, and real
device Safari behavior require separate verification. Never report them as
proven by this visual review.

The local-file browser policy blocks opening the original HTML book. Its
serialized HTML was decoded for direct text/style inspection; no alternate
browser route was used to bypass the policy.

## Implemented and rechecked

Shared buttons now preserve their size variants at every breakpoint, with
44px hit regions; native inputs/selects/groups use 44px height and 16px text.
Field labels, Home headings, profile metadata and navigation use consistent
readable sizes. Input-group buttons forward their size correctly. Dialogs use
German close labels, no scale effect or background blur; drawers also no longer
blur content. Small-window scrolling and footer access were checked.

Home gains a balanced tablet layout, a shorter action label in narrow columns,
and a flat inline notification offer. Shopping keeps its three controls in one
tablet row. Expense/Abo forms put their primary action first and become bounded
dialogs on tablets. Abo field errors sit beside the relevant input; returning
from Import to source selection clears stale errors. Reminder errors belong to
their independently loaded section, without a second empty-state panel.

Public examples lose nested filled rows and repeated headings. Offline loses
the oversized empty panel and gains semantic headings. Invalid password-reset
links no longer show new-password instructions. Login field errors target the
correct field. Settings theme names stay whole at 320px; the QR backing is only
as wide as its contents. Automatic installation overlays are suppressed inside
the WG; installation is available on demand under Darstellung. The installation
guide also recognizes iPadOS desktop user agents.

## Rendered coverage

| Area | Pages and states reviewed |
| --- | --- |
| Start | populated overview, balances, activity, notification offer, narrow and tablet columns |
| Household | Einkauf, Putzen, Vorräte, Kalender; empty/fixture states, add forms, validation, chore action sheet, calendar month/agenda/subscription |
| Finance | Ausgaben, Abos, Mahnungen, Import; expense/Abo editors, inline invalid fields, disclosures, import source/input/back, reminder error |
| Exchange/support | Pinnwand, Chat, Aktivität, Suche, Einstellungen; composer, attachment menu, chat reply/reaction/actions, long words, filters/reset, all settings tabs, installation instructions |
| Public | `/`, `/neu`, `/auth/reset`, `/offline`, not-found, `/datenschutz`; all 11 discovery modules: Einkauf, Ausgaben, Pinnwand, Putzen, Fixkosten, Mahnungen, Vorräte, Kalender, Aktivität, Chat, Einstellungen |

Four independent Luna reviewers used actual rendered pages and interactions,
not just source inspection. Astra high reviewed the shared contract and changes.
The first review found further issues; two subsequent implementation/build
rounds fixed and rechecked them. A final small iPad installation correction was
built separately. The final household tablet check completed after the planned
server rebuild; its transient Offline page was not treated as a product failure.

Phone viewports: 320×720/740/844, 390×844 and 414×896 CSS pixels. Tablet:
768×896/1024; expense/Abo footer reachability also checked at 768×500.
Primary review matrix was dark; parent also inspected light WG screens/forms
in Chrome, including 320px settings and Home. No horizontal overflow was found
in the final route reviews, including child-box checks where body overflow
could otherwise conceal it. Native date/file/validation strings followed the
review browser's English locale; this is not proof of German-device rendering.

The iPadOS installation branch was exercised in a local review tab with
`platform=MacIntel` and five emulated touch points: opening App installieren
displayed the iOS/Safari instructions. No installation or permission grant was
performed. The text does not assume the Share control is at the bottom of an iPad.

Browser screenshots occasionally captured incomplete hydration or an emulated
surface at the wrong scale. Those captures were discarded and recaptured after
the visible state settled; actual CSS viewport dimensions were measured.

## Technical verification

- Node 22.23.2; `pnpm --filter @manawg/web lint`: 428 files and 7 module boundaries pass.
- `pnpm --filter @manawg/web typecheck`: pass.
- Production `next build`: pass with fixture configuration; no server shared
  `.next` during a build.
- 12 existing Playwright API/model checks pass: Start overview, balance
  consistency, chore date status and member guards for chores/absences,
  dashboard, expenses/recurring costs, search and shopping. Run against the
  existing preview with temporary `/tmp/manawg-final-qa.config.cjs`, without
  starting another build/server. These are not 12 visual tests.
- `git diff --check`: pass. Graphify updated after code changes.

## Remaining verification limits

No known substantial visual defect remains in the reviewed states. This is not
an unconditional production release approval. The fixture environment cannot
prove account authentication, successful password recovery, persisted edits,
payments, export/import persistence, notification delivery or real offline
resynchronization. PayPal settings, notification settings and reminder history
display their load errors; no successful backend result is claimed. States
requiring unavailable data or permissions were not fabricated as successful.
No physical iPhone/iPad, Safari software keyboard or real QR scan was tested.
Real-device input/keyboard and authenticated backend acceptance remain release
checks. No push, deployment or production-data operation was performed.
