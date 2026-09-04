## Purpose

Give ManaWG's primary audience of young, smartphone-experienced residents a complete phone experience with familiar mobile interactions, quick first/repeat use, task-relevant information, touch-friendly controls and reliable feedback.

## ADDED Requirements

### Requirement: Consistent visual presentation

The app SHALL use the selected official visual reference consistently for typography, surfaces, controls, spacing and light/dark states across all redesigned routes. Necessary mobile adaptations SHALL preserve this visual identity.

#### Scenario: Move between unrelated areas
- **WHEN** a resident opens an expense editor, a shopping list and account settings
- **THEN** equivalent fields, primary actions, secondary actions and status messages have consistent visual treatment and behavior

### Requirement: Phone-first layout and operation

The app SHALL be fully operable on supported phone browsers at widths from 320 to 430 CSS pixels, with touch-accessible controls, safe-area-aware placement and no horizontal document overflow. The same mobile composition SHALL remain usable at wider widths and in phone landscape orientation.

#### Scenario: Small phone and enlarged text
- **WHEN** a resident uses a 320-pixel-wide view or enlarges text to 200 percent
- **THEN** information reflows and all essential actions remain readable and reachable without horizontal page scrolling

#### Scenario: Keyboard covers part of the viewport
- **WHEN** the on-screen keyboard opens in an editor or chat
- **THEN** the focused field, necessary context and continuation/return action remain reachable without being covered by fixed app chrome

### Requirement: Discoverable destinations and stable deep links

The app SHALL provide persistent, labeled primary destinations and visible local navigation for grouped functions. Existing WG routes, invitation links, notification targets and supported prefill parameters SHALL continue to open the intended authorized context.

#### Scenario: Open a secondary function directly
- **WHEN** a resident follows an existing calendar, inventory, reminder or import link
- **THEN** the destination opens with the correct WG and navigation context and provides a predictable return path

#### Scenario: Find a household task
- **WHEN** a resident uses the labeled navigation to find shopping, chores, inventory or calendar
- **THEN** the selected hierarchy makes the intended function discoverable and shows its WG and return context without requiring a remembered gesture or a prior tutorial

### Requirement: Decision-relevant information remains visible

Each task view SHALL show the context, available action and information needed to understand the action's consequences. Secondary options SHALL be available through explicit labels without hiding frequently needed or decision-critical facts. An enabled secondary option SHALL expose its relevant effect in the current decision context.

#### Scenario: Optional expense configuration
- **WHEN** a resident prepares an expense with an optional receipt or recurring schedule
- **THEN** amount, currency, payer, affected people and allocation remain available before saving, optional controls have meaningful labels, and any enabled recurrence is summarized before commitment

#### Scenario: A busy shopping list
- **WHEN** a household has many shopping items
- **THEN** the resident can identify each item's quantity and completion/responsibility state, use common item actions, and find further detail without scanning unrelated settings or losing necessary context

### Requirement: Understandable labels and contextual support

Navigation, consequential actions and unfamiliar controls SHALL use visible, consistent language describing their purpose. Familiar icons with clear context SHALL have accessible names. Icon-only, color-only and signed-number-only information SHALL NOT be the sole explanation of an ambiguous action or financial state. Routine mobile interactions SHALL work without a mandatory introduction tour or redundant explanatory screens; contextual help SHALL be available where the task needs it.

#### Scenario: Interpret a balance on first use
- **WHEN** a resident views an amount they owe or are owed
- **THEN** the interface states that meaning in plain language and provides the relevant party/context rather than requiring interpretation of a sign or color

#### Scenario: Identify an action without an introduction
- **WHEN** a first-time resident encounters an unfamiliar or consequential control such as recording a payment or inviting someone into the WG
- **THEN** the visible wording explains the action and its target before activation, and any necessary help is available in that context

#### Scenario: Complete a routine phone interaction
- **WHEN** a resident checks a shopping item using the existing supported completion action
- **THEN** the control responds directly with the correct pending/result state without inserting an introductory explanation of how to use a checkbox

### Requirement: Stable orientation across repeated use

After the selected navigation is introduced, repeated navigation labels and relative order SHALL remain stable across routes, empty/populated states and return visits unless the resident explicitly changes an offered preference. Live updates SHALL preserve the resident's reading and interaction context.

#### Scenario: Return on a later day
- **WHEN** a resident returns after household data has changed
- **THEN** familiar destinations and shared controls remain in the same relative positions while changed content is understandable within the stable structure

#### Scenario: Act on consecutive list items
- **WHEN** a resident checks one item and continues to the next while background updates arrive
- **THEN** the interface avoids unexpectedly moving the next touch target or resetting the reading position

### Requirement: Complete existing feature coverage

The redesigned interface SHALL expose every previously supported authorized user action for expenses, splits, payments, recurring costs, subscriptions, reminders, import, receipts, shopping, inventory, chores, absences, fairness, announcements, chat, events, search, activity and settings. Existing records and drafts SHALL remain usable after migration.

#### Scenario: Resume a less-common workflow
- **WHEN** a resident resumes an import, changes a recurring cost, records an absence or manages a calendar subscription
- **THEN** the redesigned app provides that workflow with its existing permissions, data meaning and completion/error behavior

### Requirement: Intent-preserving entry and account context

The app SHALL preserve create/join intent through authentication and SHALL distinguish guest, new-WG, returning-member and multi-WG states. Account or WG switching SHALL not expose private content from the previous context.

#### Scenario: Join from an invitation
- **WHEN** an invited resident completes the configured authentication flow
- **THEN** the app resumes the intended invitation path and explains the next step without silently creating an unrelated WG

#### Scenario: Empty new WG
- **WHEN** a creator opens a new WG with no activity
- **THEN** the app offers an actionable invitation or first-use path without inventing household data

### Requirement: Predictable editors and cancellation

The app SHALL distinguish entering data, reviewing its consequences and saving it. Back/cancel SHALL preserve meaningful drafts or explicitly explain a discard choice; dismissing an editor SHALL not submit it.

#### Scenario: Cancel a partially completed expense
- **WHEN** a resident enters an amount and description and then leaves the editor
- **THEN** no expense is created, and meaningful unsaved input is retained or discarded only through an explicit, understandable choice

#### Scenario: Return from editing an item
- **WHEN** a resident completes or cancels an edit
- **THEN** the app returns to the originating context with a coherent list position and appropriate focus

### Requirement: Clear financial consequences

Financial actions SHALL identify the payer, amount, participants and resulting allocation before committing. Recording a payment that already happened SHALL be distinguishable from initiating a provider payment, and settlement review SHALL match the actual affected records.

#### Scenario: Review a shared expense
- **WHEN** a resident records a 30-euro expense paid by Anna and split equally with Ben and Cem
- **THEN** the review shows a 10-euro share per person and the resulting obligations before the resident saves

#### Scenario: Record a payment without transferring money
- **WHEN** a resident records an already-made payment
- **THEN** the interface identifies the records and amount affected and states that this action does not transfer money

#### Scenario: Convert a shopping entry to an expense
- **WHEN** a resident chooses to use a shopping item in an expense
- **THEN** the app opens an explicit reviewable expense entry and does not silently create debt

### Requirement: Truthful asynchronous and offline states

Every relevant screen SHALL distinguish loading, empty, saving, success, queued offline, failure, unauthenticated and unauthorized states. Failure SHALL preserve recoverable user input and offer an appropriate next action. A queued operation SHALL not be presented as synchronized.

#### Scenario: Save while offline
- **WHEN** a resident performs an action supported by the existing offline workflow while disconnected
- **THEN** the app labels it as queued locally and preserves its WG/member scope until synchronization is confirmed

#### Scenario: Save fails
- **WHEN** a save request fails after the resident has entered data
- **THEN** the input remains available, the app explains the failure and retry does not create duplicate records

### Requirement: Accessible and meaningful motion

Animation SHALL communicate interaction or state without delaying action, conveying false completion or becoming necessary to understand the app. The interface SHALL honor the user's reduced-motion preference and remain operable without hover or gesture-only controls.

#### Scenario: Reduce motion is enabled
- **WHEN** a resident enables reduced motion at the system level
- **THEN** large positional/layout animations are removed or simplified while selection, saving and error states remain understandable

#### Scenario: Animated checkbox save fails
- **WHEN** a shopping checkbox changes optimistically and the save subsequently fails
- **THEN** the interface clearly restores or marks the unresolved state instead of leaving a success indication

### Requirement: Account and household settings have clear scope

Settings SHALL distinguish account/device controls from household controls. Member changes, leaving, data export and notification preferences SHALL describe and enforce their actual scope and existing permission requirements.

#### Scenario: Manage household membership
- **WHEN** a resident views an action that changes membership
- **THEN** the interface identifies the affected household/member and the available action matches the resident's existing permissions
