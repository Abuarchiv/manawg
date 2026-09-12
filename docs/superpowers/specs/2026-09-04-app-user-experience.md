# ManaWG App User Experience Specification

**Status:** Local implementation completed and source-reviewed on 2026-09-05; resident validation remains open. This document defines the intended experience. See the [implementation record](../../releases/product-experience-implementation.md) for delivered behavior, local proof and remaining limits; no resident satisfaction claim is made.

## Objective

ManaWG should help people notice a shared-household need, make the next action obvious, let the other residents know what changed, and make completion or correction easy. The app is for real WG residents who may arrive as guests, invitees, creators, returning members, or members switching between WGs. The release target is a coherent, calm, reliable product experience across the existing app/PWA surface.

Success means a resident can understand where they are, what needs attention, what will happen after an action, and how to correct it. Financial consequences, permissions, offline status, and account state must be visible at the moment they matter.

## Scope and constraints

- Preserve the five primary tabs and labels: **Start**, **Ausgaben**, **Einkauf**, **Pinnwand**, **Putzen**.
- Keep the existing context-aware child routes and `SubNav` hierarchy. A child page must show its WG context and offer a clear path back to its parent or tab.
- Keep calendar available in its existing context rather than adding a new primary navigation item.
- Separate account settings (identity, recovery, device/session) from WG settings (members, permissions, subscriptions, integrations).
- Reuse existing components, patterns, routes, and data. Do not add an AI guide, tutorial tour, gamification, provider, or navigation rewrite.
- Preserve visible data and drafts. Back/cancel must be reversible; saving must be explicit enough that a resident knows whether data was written.
- Product decisions below are recommendations for review. They are not user research results or permission to change financial scope.

## Experience model

### Four entry situations

| Resident | First useful moment | Required feeling |
| --- | --- | --- |
| Guest | See what the app is for and choose a WG action | Curious, safe, no accidental account/WG commitment |
| Invited member | Understand the invitation, sign in, and arrive in the intended WG | Certain that the invite was preserved and private data is protected |
| Creator | Create a WG, invite residents, and start one shared action | Guided by the next practical step, not an empty dashboard |
| Returning resident | Resume an unfinished need or switch to another WG | Oriented immediately, with drafts and pending work intact |

The same shell should make these states distinct. Never use a local browser hint to silently choose a WG or imply that an account action succeeded.

### Core value loop

1. A resident notices a need: “Die Milch ist leer”, “Die Rechnung muss geteilt werden”, or “Das Bad ist dran”.
2. The relevant tab presents one clear next action with enough context to choose correctly.
3. The action makes the resulting responsibility visible to the household: item, payer/split, assignee, notice, or event.
4. Other residents can see and act on the change without guessing whether it is current, completed, paid, or merely discussed.
5. Completion is acknowledged, fair, and correctable. Edits explain what changed and preserve a safe recovery path.

## Observed evidence, hypotheses, and unknowns

Observed in the existing signed-in Chrome session: the dashboard showed empty statistics/chart content and a repeated WG-name welcome; Ausgaben and Putzen had useful empty templates and forms opened without saving; Putzplan fit at `390x844` with a clear primary action; the five-tab navigation was present. `apps/web/src/components/wg/SubNav.tsx` already provides a sensible child hierarchy. Source inspection: `apps/web/src/features/shopping/components/ShoppingItemRow.tsx` has a receipt action linking to `/ausgaben?desc=item.name`, “von X” metadata can mean added or bought, long names truncate, and completion/delete/receipt actions appear on the same row. Whether these controls cause confusion remains a hypothesis. `apps/web/src/components/wg/PageHeaderActions.tsx` hides the mobile label and uses generic desktop “Neu”. `ProfileTab.tsx` and the settings page currently describe identity/data as device-local, which conflicts with account-backed membership. The inspected local source is `2c7fc58`; the prior audit compared relevant changes with remote `8f845cd`. These are design inputs, not a claim that every live route is bound to that source revision.

Hypotheses to test: an empty dashboard without a next action makes a new creator wonder whether setup failed; “von X” makes residents misread who owns a shopping responsibility; unlabeled icons slow first use; residents may confuse a chat message with a durable household notice; “leave WG” may be interpreted as deleting an account or household data.

Unknowns: which next action is most useful for each household, whether “Ausgabe hinzufügen” is clearer than an icon for existing residents, whether the calendar context is discovered, and whether the current split/paid wording is understood under time pressure. No user satisfaction or task completion rate is claimed yet.

## Screen contracts

Every screen below has one primary action, a clear next result, and states that do not erase context.

| Screen | Goal | Primary action | Key information | Next result |
| --- | --- | --- | --- | --- |
| Guest entry | Understand the app and choose create/join | “WG erstellen” or “Einladung öffnen” | What remains public; what sign-in enables | Validated intent survives auth; no private WG data |
| Auth/invite | Recover or establish the account for this intent | The selected configured sign-in method | Invite intent, safe return path, neutral errors; WG name only when the current authorization contract permits it | Return to intended create/join step, never an unrelated WG |
| Dashboard | Resume the household’s most useful action | Contextual CTA such as “Erste Aufgabe anlegen” or “Mitbewohner einladen” | WG name, pending work, recent changes, concise stats after the action area | Opens the relevant form with WG context preserved |
| Expenses | Record and understand a shared cost | “Ausgabe hinzufügen” | Payer, amount, currency, split, status, receipt | Clear result: who owes whom, or “noch nicht abgerechnet”; editable |
| Shopping | Coordinate buying without creating debt by surprise | “Artikel hinzufügen” | Item, quantity, who added, who bought, purchased state | Optional explicit “Als Ausgabe übernehmen” opens prefilled expense review |
| Chores | Make the next fair responsibility obvious | “Aufgabe hinzufügen” or the existing primary action | Task, cadence, current assignee, last completion, next assignee | Completion updates the schedule and shows the next assignee/reason |
| Pinnwand/calendar | Choose durable notice versus time-bound event | “Beitrag schreiben” or existing event action | Author, date, audience, expiry/time, attachments if present | Notice remains findable; event appears in calendar context |
| Settings | Manage the right scope safely | Account or WG section action | Account/session versus WG/member/integration scope | Confirmation names exact scope and offers safe return |

Suggested German copy: “Was ist jetzt wichtig?”, “Mitbewohner einladen”, “Noch keine Ausgaben – füge die erste gemeinsame Ausgabe hinzu.”, “Noch nichts eingetragen – erstelle eine Aufgabe für die WG.”, “Als Ausgabe übernehmen”, “Die Ausgabe ist noch nicht gespeichert. Prüfe Betrag und Aufteilung.”, “Erledigt. Nächster Termin: Mittwoch; Alex ist laut Rotation dran.”, “Chat für schnelle Abstimmung · Pinnwand für Dinge, die bleiben sollen.” Populate result copy only from the actual server-confirmed result.

## Visual and interaction consistency

- Keep the existing restrained palette, typography, and semantic tokens. Use spacing and type weight to prioritize the current task; avoid turning every statistic, hint, and action into an equally prominent card.
- A screen header identifies the place; the content explains the current situation; one prominent action advances that situation. Secondary links remain readable. The first-use dashboard prioritizes invitation/first action; an established WG prioritizes today's actual tasks and balances.
- Use a consistent row anatomy: main item/title, meaningful status, responsible person/time, then action. Distinguish “hinzugefügt von”, “gekauft von”, “zuständig” and “bezahlt von”; an avatar alone does not explain the role.
- Use visible contextual labels where an icon's consequence is ambiguous, particularly money and account actions. Keep familiar compact controls where comprehension is demonstrated. Never make hover the only way to discover an action on a phone.
- Group the essential form fields first; expose optional receipt, recurrence and advanced split controls progressively. Labels stay visible after typing. Show the resulting split before committing; validation is adjacent to the field and preserves other input.
- Back/cancel closes the current interaction and returns to a predictable location. Distinguish keeping a local draft, discarding a draft, and undoing a saved action. Request discard confirmation only when meaningful unsaved input would be lost.
- Review narrow (320/390px), tablet and desktop layouts, long names/amounts, empty and dense lists, light/dark themes, enlarged text, keyboard focus, screen-reader labels, and mobile keyboard coverage. These are proposed design checks, not completed accessibility certification.

Illustrative three-person expense walkthrough: Anna paid €30 for a shared shop; an equal split preview shows €10 per person, with Ben and Cem each owing Anna €10. Saving records the expense; it transfers no money. A later manual confirmation names the exact already-made payment and affected records. A PayPal action explicitly initiates a payment through PayPal. This example is for design review with fictional data, not evidence of an executed transaction.

## Flow decisions

### Entry, create, invite, and return

Guest browsing can show useful empty states and the existing tab structure. Creation and joining remain explicit actions that require the account flow. An invitation always wins over an unrelated remembered WG. After authentication, show the intended action again before any write: “Du möchtest der WG ‘Sonnenhof’ beitreten.”

The creator’s first landing view puts one useful action/invite block above statistics. It should answer “Was kann ich jetzt tun?” without fabricating tasks, members, or activity. A returning resident with pending offline work sees that work before a new recommendation.

### Shopping to expense

Keep the existing one-item receipt entry point for simplicity, but make the transition explicit and reviewable. Prefill item name and known context; do not automatically create a debt or mark an item paid. Use “Als Ausgabe übernehmen”, then show payer, amount, split, and confirmation. Clarify metadata as “hinzugefügt von …” and “gekauft von …” when those are distinct. If the full basket flow is later needed, it must preserve this same explicit financial boundary.

### Expenses

Show the record in the order residents reason about it: amount/currency, payer, split, current result, and paid/settled status. “Saldo” is a summary; the item detail must answer “Wer hat bezahlt?”, “Wer schuldet wem wie viel?”, and “Ist es erledigt?”. Duplicate/import/offline warnings name the consequence and leave the original record intact.

In the inspected source at `2c7fc58` (this file is unchanged in fetched `origin/main` at `8f845cd`), `apps/web/src/components/wg/DebtSummary.tsx` renders a visible “Beglichen” button that immediately posts `settle-batch`, while the displayed net amount may represent simplified debts that are not directly settleable splits. The experience must separate three facts: the summary amount, the exact records that can be settled, and any external payment such as PayPal. Before an accounting write, show a concise review identifying payer, recipient, amount and actual affected records; a suitable action is “Bereits erfolgte Zahlung eintragen”, with the explanation “Hier wird kein Geld überwiesen.” If only some splits are supported, show the partial scope before confirmation and leave the remainder visible. If the backend returns `no_direct_splits` or an equivalent partial outcome, explain it in resident language and keep the original expenses. “Beglichen” must never imply a PayPal transfer or silently record more than the resident reviewed. A one-click settlement can return only after the displayed result and write contract are identical and the confirmation is clear.

### Chores

Completion should state the next assignee and the reason: “Erledigt. Nächster Termin: Mittwoch, Alex ist dran (Rotation).” Preserve the existing owner/admin permissions and current fair rotation behavior. `ChoreRow` currently arms the tick with an “OK” confirmation; keep a visible confirmation step and add the next-assignee preview before writing if no safe undo exists. Do not promise undo until the existing behavior provides it. A resident can correct a mistaken completion without hiding the prior state.

### Communication and reminders

Chat is for quick coordination; Pinnwand is for durable household knowledge; calendar is for dated commitments. Labels and empty states should teach this distinction in one sentence. Reminders should be restrained, actionable, and controllable through existing preferences; changing defaults is a product decision. Do not promise snooze, read receipts, automatic cross-posting or delivery unless implemented and verified. Never make a reminder sound like a punishment or imply that a notification means another resident has read something.

### Account, WG, and data settings

Use section titles and copy that separate “Mein Konto und meine Geräte” from “Diese WG”. Explain that local drafts/cache are device-local while account membership and synchronized WG data are server-backed. A leave/deactivate action states exactly whether it removes this member from this WG, clears local hints, or changes account access; offer undo where the operation is low-risk and safe. Destructive actions name their scope before confirmation.

## State contract

Each screen has explicit variants: initial, empty, loading, pending save, success, offline pending, failure, unauthorized, permission denied, account switching, and long-content overflow. Loading preserves the shell and context. Offline pending says what is queued and when it will retry; it never claims synchronization. Failure offers retry and preserves typed drafts. Unauthorized explains the required sign-in; permission denied explains who can act. Account switching clears private view state before loading the next account/WG. Long names wrap or reveal on demand; no essential action depends on an icon alone.

These rules follow the product-facing parts of [Nielsen Norman Group’s usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): show current status, use residents’ language, prevent errors before irreversible writes, and provide a clear exit or recovery path. They are applied here to concrete app states, not treated as a substitute for resident testing.

## Three unresolved choices for product review

1. **Dashboard first action — recommend one primary action and one secondary invite/module link.** In a new one-person WG, start with “Mitbewohner einladen”; once that is no longer useful, prioritize a real pending action or first module entry. Let users continue alone and do not repeatedly prompt after dismissal. Confirm which branch is useful through testing; do not add a setup wizard by default.
2. **Primary action labels — recommend visible contextual labels on mobile and desktop.** Keep existing navigation and `PageHeaderActions` structure, but test “Ausgabe hinzufügen”, “Artikel hinzufügen”, and “Aufgabe hinzufügen” where generic “Neu” or an icon forces interpretation. Adopt only where comprehension improves.
3. **Leave semantics — recommend server-backed member deactivation with explicit scope.** Reuse existing member permissions and active-member guards; do not change owner succession or invent a new role model. Confirm last-member behavior in the existing rules before implementation.

## Usability test protocol

Recruit five representative WG residents: a creator, an invited member, a multi-WG account user, a returning resident with pending work, and a lower-tech smartphone user. This small test is directional, not statistically representative.

Give each person scenarios, without click instructions:

- “Du bist neu und möchtest eine WG erstellen und jemanden einladen.”
- “Du hast eine Einladung für ‘Sonnenhof’ und willst beitreten, ohne in einer anderen WG zu landen.”
- “Die Milch ist leer. Trage sie so ein, dass die anderen wissen, was zu tun ist.”
- “Du hast für die WG bezahlt. Zeige, wer jetzt wem wie viel schuldet.”
- “Prüfe eine Begleichung. Erkläre, was wirklich in der App verbucht wird und was eine externe Zahlung wäre.”
- “Das Bad ist erledigt. Finde heraus, wer als Nächstes dran ist.”
- “Schreibe eine schnelle Abstimmung und hinterlasse eine Information, die nächste Woche noch auffindbar ist.”
- “Wechsle das Konto/WG und prüfe, dass du keine Daten der anderen WG siehst.”

Record expected outcome, hesitation, backtracking, misunderstood scope, financial/privacy explanation, completion, and recovery from an error. Before each consequential action ask “Was erwartest du, dass jetzt passiert?” without explaining the control. Include one accidental completion, one network failure while saving, and one return to an unfinished draft. Proposed acceptance: at least 4/5 independently complete each core scenario, zero participants misunderstand a debt/paid state or cross-WG privacy boundary, and repeated confusion has a concrete correction. Minor isolated hesitations enter a ranked backlog. Repeat the affected tasks after fixes; do not turn a five-person result into a statistical satisfaction claim.

## Delivery priority and acceptance

1. **UX0 — coherence rules:** approve the value loop, state contract, financial boundaries, account/WG distinction, and the three choices above.
2. **UX1 — state walkthroughs:** produce low-fidelity screen/state walkthroughs for the four entry situations and screen contracts; include mobile dimensions and back/cancel paths.
3. **UX2 — vertical slices:** implement dashboard next action, explicit shopping-to-expense review, clear expense result, fair chore completion, and settings scope copy using existing primitives. Each slice includes its states and a focused Playwright path.
4. **UX3 — resident testing:** run the protocol, record observed behavior, iterate copy/hierarchy, and update this spec with decisions. Do not call the result user-validated before this step.
5. **Technical release plan:** only after UX3 decisions are accepted, apply the separate release plan’s hosted auth, privacy, PWA, integration, and operational gates.

The UX work is done when residents can state where they are, what the primary action will change, who will be affected, and how to correct it; the existing five-tab structure remains discoverable; dashboard empty states lead to a useful next step; financial and privacy consequences are understood; drafts/back/offline states are honest; and no unresolved recommendation is silently treated as an approved scope change.
