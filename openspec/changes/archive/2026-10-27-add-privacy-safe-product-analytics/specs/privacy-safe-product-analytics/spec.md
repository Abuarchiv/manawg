## Purpose

Measure whether visitors reach ManaWG's collaborative value without creating persistent analytics identities or collecting household content.

## ADDED Requirements

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

### Requirement: Honest disclosure
Public metadata and a reachable privacy page SHALL accurately describe the anonymous analytics provider, region, collected data, disabled features, purpose, and blocking behavior.

#### Scenario: Privacy disclosure is reachable
- **WHEN** a visitor opens the privacy page or inspects the public metadata
- **THEN** the disclosure identifies PostHog EU, the anonymous events collected, the disabled tracking features, the product-improvement purpose, and that the app remains usable when analytics is unavailable
