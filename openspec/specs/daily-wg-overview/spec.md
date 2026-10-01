# daily-wg-overview Specification

## Purpose
Give WG members a discoverable daily overview that separates their own actions from household context and shows reliable navigation counts and chore rotation. Keep financial information, loading/error states, and existing mutations trustworthy on small phones in both themes.

## Requirements

### Requirement: Primary destinations and sibling routes remain visible

The application SHALL retain Start, Haushalt, Finanzen, and Austausch as primary destinations and SHALL retain the label "Ausgaben". Haushalt SHALL expose Einkäufe, Putzplan, and Vorräte; Finanzen SHALL expose Ausgaben and Fixkosten; Austausch SHALL expose Pinnwand, Chat, and Kalender. Existing route URLs SHALL continue to resolve, and navigation SHALL NOT hide sibling destinations in an opaque overflow menu.

#### Scenario: Calendar is opened through an existing deep link
- **WHEN** a member opens the existing WG calendar URL
- **THEN** the calendar SHALL load with Austausch active and all three Austausch segments visible

#### Scenario: Navigation is used on a narrow phone
- **WHEN** a changed view is rendered at a 320px viewport
- **THEN** all sibling route names SHALL remain discoverable without horizontal page overflow, with the active route indicated independently of color

### Requirement: Counts describe known actionable state

Section counts SHALL represent open shopping items, the current member's due/overdue chores, due recurring expenses, and server-confirmed unread chat messages. Confirmed zero counts SHALL omit the badge. Unavailable or still-loading counts SHALL NOT be converted into a confirmed numeric zero. Counts greater than 99 SHALL remain compact visually while exposing the actual number and meaning to assistive technology.

#### Scenario: A read has not succeeded
- **WHEN** a count source is loading or fails without prior data
- **THEN** navigation SHALL NOT present a fabricated zero or an all-clear statement, and the loading/unavailable state SHALL be distinguishable from a successful empty result

#### Scenario: A mutation changes the active module
- **WHEN** a shopping or chore mutation succeeds, rolls back, or is queued offline under the existing behavior
- **THEN** its displayed count SHALL agree with the currently visible module state and SHALL reconcile with the next authoritative response

#### Scenario: Chat is opened but its read acknowledgement fails
- **WHEN** navigation enters Chat and the server has not confirmed that messages were read
- **THEN** the unread count SHALL NOT be cleared solely because Chat is the current route

### Requirement: Personal home items distinguish ownership and preserve financial meaning

Start SHALL show "Für dich" with the current member's own chores, personal pending requests, and personal settlement directions. Other members' chores SHALL NOT be presented as the current member's responsibility. Shared shopping and recurring-cost notices SHALL remain reachable and explicitly identify their shared context. Settlement counterparties, amounts, signs, and currencies SHALL agree with Ausgaben for the same data snapshot.

#### Scenario: Several members have outstanding chores
- **WHEN** Start derives its personal list
- **THEN** only the current member's chores SHALL appear as personally actionable, while other members' relevant chores remain available in the household agenda or Putzplan

#### Scenario: A member has several settlements or currencies
- **WHEN** the financial data contains multiple counterparties or currencies
- **THEN** each personal settlement SHALL retain its own identity, amount, direction, and currency without missing or duplicated rows

#### Scenario: Financial data cannot be read
- **WHEN** required financial data is unavailable
- **THEN** Start SHALL NOT show fabricated balances or an "all settled" state and SHALL preserve the current financial failure behavior

### Requirement: The weekly agenda uses explicit Berlin calendar boundaries

The heading "Diese Woche" SHALL refer to the current Monday-through-Sunday calendar week in Europe/Berlin. The agenda SHALL show relevant household events and other members' chores from today through the end of that week. Earlier outstanding chores SHALL be explicitly separated as overdue rather than mislabeled as dates in the current week. The current member's chores already shown in "Für dich" SHALL NOT be duplicated as household agenda chores.

#### Scenario: The browser remains open across midnight or a week boundary
- **WHEN** the Berlin calendar day changes or the view resumes after that change
- **THEN** the agenda range, grouping, and requests SHALL update without requiring a page reload

#### Scenario: The week crosses a daylight-saving transition
- **WHEN** Berlin has a 23-hour or 25-hour day
- **THEN** events and chores SHALL still fall under the correct calendar date and week boundaries; all-day events SHALL retain their intended date

#### Scenario: Event data is loading or unavailable
- **WHEN** the event source has not completed successfully or fails
- **THEN** the agenda SHALL show loading or failure/stale status rather than stating that nothing is scheduled, while available chore information may remain visible

#### Scenario: The agenda contains more items than the initial preview
- **WHEN** only a bounded number of agenda rows is initially visible
- **THEN** the remaining items SHALL be reachable through an explicit count/action or the existing calendar/Putzplan destination, without hiding the section's existence

### Requirement: Chore rows show the next predicted assignee

Putzplan rows SHALL identify the current assignee and the next predicted assignee using the same eligibility and rotation rules as chore completion. Absent and deactivated members SHALL NOT be presented as eligible next assignees. The current named row action and confirmation SHALL remain the way to complete a chore; no ambiguous duplicate global completion action SHALL be added.

#### Scenario: The next eligible member is the current viewer
- **WHEN** the current rotation calculation selects the viewer
- **THEN** the row SHALL express the next person naturally as "du" while keeping the current assignee unambiguous

#### Scenario: No member is currently eligible
- **WHEN** the rotation cannot select an available next member
- **THEN** the row SHALL NOT invent a next assignee or imply a successful future assignment

### Requirement: Existing secondary destinations and corrected interactions remain intact

The existing Erinnerungen destination SHALL be reachable from the visible balance-card content without opening collapsed balance details. Start search SHALL remain visible outside collapsed news, and current main's default-open news behavior SHALL remain intact. The port SHALL preserve current idempotency, retries, offline actions, shared-cache reconciliation, loading headers, legal links, settings anchors, and Auth-provider behavior.

#### Scenario: A completion request has an uncertain result
- **WHEN** an existing Home or Putzplan completion request is retried after a network error, 5xx, or 429 response
- **THEN** the current safe retry/idempotency behavior SHALL remain intact and SHALL NOT create a second completion because of this UI port

#### Scenario: A user needs reminder history
- **WHEN** the balance card is visible with its details collapsed
- **THEN** its Erinnerungen link SHALL be visible, keyboard-operable, and route to the existing reminder history

### Requirement: Changed views meet the current phone and theme contract

Changed views SHALL work at 320px and 390px in light and dark mode, retain at least 44px interaction targets, visible focus, readable labels and state indicators, and the existing reduced-motion/transparency/contrast behavior. Content SHALL use the current neutral design tokens; navigation glass SHALL remain confined to the authorized navigation layer. Existing toast placement above any retained thumb action SHALL not regress.

#### Scenario: Long names and large counts appear on a phone
- **WHEN** a changed view contains long chore/member names, several currencies, and a count above 99
- **THEN** its labels and actions SHALL remain usable without clipped focus indicators, hidden destinations, overlapping touch targets, or horizontal page overflow

#### Scenario: A user requests reduced motion or increased contrast
- **WHEN** platform accessibility preferences are enabled
- **THEN** the changed views SHALL retain the current static motion fallback, visible focus, and opaque/high-contrast navigation fallback
