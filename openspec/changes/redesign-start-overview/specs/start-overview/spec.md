## ADDED Requirements

### Requirement: Prioritized next actions

Start SHALL show pending work before financial summaries. It SHALL identify personal chore responsibility by member ID, show assignee context for shared chores, prioritize overdue work and personal responsibilities, and rank candidates before limiting visible items. One focus and at most two secondary items SHALL be initially visible; remaining candidates SHALL remain accessible through an expandable list. The same task SHALL NOT appear in multiple Start sections.

#### Scenario: Busy WG
- **WHEN** a resident opens Start with multiple pending chores, shopping and recurring expenses
- **THEN** the highest priority item is shown first with its destination and ownership context, two secondary items are visible, and further items can be expanded without losing access

### Requirement: Compact context

Start SHALL display a compact personal balance with its correct direction and a link to Finanzen. It SHALL retain the four existing primary navigation destinations and show recent WG context without a duplicate module directory or health score.

#### Scenario: Positive balance
- **WHEN** the resident has a positive balance
- **THEN** Start says the resident receives that amount, with access to the existing financial details

### Requirement: Complete states

Start SHALL present a useful invite/list entry for a new WG, a calm message for no pending work, loading placeholders until data arrives, and existing retry/error behavior. Expandable content SHALL respect reduced motion and remain keyboard accessible.

#### Scenario: Failed refresh
- **WHEN** a dashboard refresh fails after data was loaded
- **THEN** the last data remains visible with an error and retry control, without falsely showing an empty or successful state

### Requirement: Quiet, dismissible optional hints

Start SHALL use one shared header with the WG name, greeting and matching chat/account controls. Its optional welcome SHALL be dismissible with a persistent preference scoped to the stable WG and member IDs on the device. Dismissal SHALL NOT hide pending work or remove the existing shopping and invitation destinations. The push offer SHALL use standard shadcn controls inline, preserve its existing dismissal, and request permission only after explicit activation.

#### Scenario: Dismissed welcome after reload
- **WHEN** a resident dismisses the welcome and reloads Start
- **THEN** the welcome remains hidden for that resident and WG, while another WG retains its own preference
