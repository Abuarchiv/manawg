# privacy-safe-product-analytics Specification

## Purpose
Measure whether visitors reach ManaWG's collaborative value without creating persistent analytics identities or collecting household content.

## Requirements

### Requirement: Minimal anonymous analytics
The app SHALL initialize PostHog only when configured and SHALL use the EU endpoint without cookies, persistent identifiers, person profiles, autocapture, or session replay.

#### Scenario: Analytics unavailable
- **WHEN** the project key is absent, blocked, or the provider is unavailable
- **THEN** every product flow continues without an error shown to the user

### Requirement: Activation events
The app SHALL capture successful WG creation and successful WG joining. Event properties MUST NOT include personal identity, WG identity, invite codes, household content, financial data, or free-form user input.

#### Scenario: WG creation fails
- **WHEN** a creation request fails
- **THEN** no successful creation event is captured

### Requirement: Funnel events
The app SHALL capture the funnel steps `signup_submitted`, `signup_confirmed`, `login_completed`, `invite_opened`, `invite_join_failed` and `first_expense_created`, each once per occurrence. `invite_opened` also counts a dead link; `invite_join_failed` means a join was attempted and rejected. `first_expense_created` means the first expense as this device sees the WG (an empty list), so it can repeat per device and is missed for expenses queued offline. The only event property is the API error code of `invite_join_failed`; it MUST be a lowercase snake-case code and is replaced by `other` otherwise.

#### Scenario: Invite join is rejected
- **WHEN** joining a WG through an invitation fails
- **THEN** `invite_join_failed` is captured with the error code and without the invite token, the name or any WG identity

#### Scenario: A dead invite link is opened
- **WHEN** an invitation page opens on an invalid or expired link
- **THEN** `invite_opened` is captured and `invite_join_failed` is not

#### Scenario: Sign-in is confirmed by the server
- **WHEN** `/auth/callback` establishes a session
- **THEN** the page it redirects to sends `signup_confirmed` or `login_completed` exactly once and the one-shot marker cookie is deleted. The cookie `manawg_funnel` lives two minutes, holds only the step name and carries no identifier

### Requirement: Honest disclosure
Public metadata and a reachable privacy page SHALL accurately describe the anonymous analytics provider, region, collected data, disabled features, purpose, and blocking behavior.

#### Scenario: Privacy disclosure is reachable
- **WHEN** a visitor opens the privacy page or inspects the public metadata
- **THEN** the disclosure identifies PostHog EU, the anonymous events collected, the disabled tracking features, the product-improvement purpose, and that the app remains usable when analytics is unavailable
