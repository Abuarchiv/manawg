## Purpose

Make frequently visited WG pages feel immediate and predictable on a phone while preserving the app's existing offline and household-data behavior.

## ADDED Requirements

### Requirement: Cached WG read views

WG read views SHALL show the last successfully loaded content immediately on same-session revisits while requesting current server data in the background. A loading skeleton SHALL appear only when no successful data exists for the requested resource.

#### Scenario: Revisit a WG page

- **WHEN** a member revisits a WG page with data cached in the current session
- **THEN** the cached content is visible immediately and a fresh read runs in the background

#### Scenario: Refresh after returning to the app

- **WHEN** the browser window regains focus while a WG page is mounted
- **THEN** the page revalidates its server data and keeps existing content visible during the request

#### Scenario: Preserve offline work

- **WHEN** a page synchronizes queued work or restores a local draft
- **THEN** cache revalidation does not discard the existing offline queue or draft behavior

### Requirement: Immediate and recoverable WG actions

The specified household actions SHALL update their visible state immediately, then keep the update when the server confirms it or restore the prior state and show an error toast when the request fails. Offline-queued work SHALL retain its existing queued status and recovery behavior.

#### Scenario: Server confirms an optimistic action

- **WHEN** a member completes a chore or changes an expense, subscription, calendar event, or reminder
- **THEN** the relevant page reflects the action before the request finishes and reconciles with the server response

#### Scenario: Server rejects an optimistic action

- **WHEN** one of those requests fails
- **THEN** the prior visible state is restored and the member receives an error toast

### Requirement: Continuous WG navigation

WG subpage navigation SHALL retain a useful skeleton layout while the destination is pending, prefetch its linked destinations, and use brief reduced-motion-aware visual feedback. Reduced-motion preferences SHALL show the final page state without an entrance animation.

#### Scenario: Navigate to a WG subpage

- **WHEN** a member selects a WG navigation link
- **THEN** the destination is prefetched and pending navigation keeps the WG page structure visible

### Requirement: Immediate touch feedback

Tappable shared buttons, links, and list rows SHALL provide a visible pressed response within 100 milliseconds while preserving their accessible target size and reduced-motion preferences.

#### Scenario: Press a control

- **WHEN** a member taps a button, link, or tappable row
- **THEN** the pressed state is visible immediately and does not bounce after release

### Requirement: Thumb-reachable primary actions

Each in-scope WG page SHALL expose exactly one primary page action in the lower thumb-reach area above the fixed bottom navigation, including safe-area spacing. The expenses page SHALL lead with the balance summary and its settlement action.

#### Scenario: Use a page's primary action

- **WHEN** a member opens an in-scope WG page on a phone
- **THEN** its single primary action is reachable above the bottom navigation without obscuring page content

#### Scenario: Open expenses

- **WHEN** a member opens the expenses page
- **THEN** the balance summary and settlement action appear before the expense list
