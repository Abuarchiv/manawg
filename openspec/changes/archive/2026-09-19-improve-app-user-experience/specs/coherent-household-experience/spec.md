## Purpose

Make everyday household actions understandable from entry through completion, including their financial, membership, and offline consequences.

## ADDED Requirements

### Requirement: Contextual household orientation
The app SHALL preserve its existing five primary sections and show a useful next action appropriate to a new or returning household member, without fabricating content or representing loading failures as empty data.

#### Scenario: First household visit
- **WHEN** a verified member opens a household with no recorded activity
- **THEN** the page offers a practical invitation or first-action path ahead of empty statistics while keeping existing information accessible

### Requirement: Explicit financial action scope
The app MUST distinguish recording an expense, confirming an already completed external payment, and initiating a provider payment. A manual settlement MUST require review of its supported amount and records; changed scope MUST NOT silently settle a different amount or record set.

#### Scenario: Confirm an external payment
- **WHEN** a member reviews and confirms a manual settlement
- **THEN** the interface explains that no money is transferred and the server either records the reviewed scope or rejects stale scope without changing financial data

### Requirement: Predictable household workflow transitions
Shopping-to-expense transitions SHALL preserve known context as an unsaved draft without inventing an amount. Shopping metadata SHALL distinguish who added and who bought an item. Chore completion SHALL explain its effect without promising unsupported undo or an unconfirmed next assignee.

#### Scenario: Record a purchase
- **WHEN** a user chooses to turn a purchased item into an expense
- **THEN** the expense form shows the draft context and allows review of payer, amount and split before any accounting write

### Requirement: Honest account and household scope
The interface SHALL distinguish local drafts/session data from synchronized household data, account sign-out from persistent household leave, and permitted from forbidden member actions. Persistent leave MUST use authorized membership changes and MUST retain existing historical data and permission rules.

#### Scenario: Leave a household
- **WHEN** an authorized member confirms leaving their household
- **THEN** their active membership access ends and a subsequent account membership lookup does not automatically return them to that household

### Requirement: Recoverable interaction states
Core forms and list actions SHALL retain meaningful input on a failed save, distinguish queued offline work from synchronized success, present contextual action labels, and provide predictable back/cancel behavior. Essential content MUST remain accessible on narrow screens and with keyboard navigation.

#### Scenario: Saving fails
- **WHEN** a user action fails or is queued offline
- **THEN** the interface names the actual state, preserves recoverable input, and offers only actions that the current data and permissions support

### Requirement: Evidence-based completion
Automated local, hosted, device, and resident usability evidence MUST be reported separately. Missing required credentials or cleanup MUST fail the applicable protected release gate; a disabled or skipped suite MUST NOT count as completed verification.

#### Scenario: Required hosted evidence is unavailable
- **WHEN** the required hosted credentials or same-revision database evidence are missing
- **THEN** the release gate remains failed or explicitly blocked and the report identifies the missing prerequisite without exposing secrets
