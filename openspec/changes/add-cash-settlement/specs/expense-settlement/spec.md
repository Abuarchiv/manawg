## ADDED Requirements

### Requirement: Cash settlement of a netted debt

The system SHALL let either member of a netted debt record a cash payment for the exact current net amount. The payment MUST be stored as a completed payment between the two members so that every balance view reflects it, and the server SHALL reject it when the net debt changed since the review or when a PayPal payment is being captured.

#### Scenario: Chained debt is cleared in cash

- **WHEN** A owes B 20 and B owes C 20, the Saldo shows "A owes C 20", and A or C records a cash payment of 20
- **THEN** the debt between A and C is cleared and the Saldo no longer lists it

#### Scenario: Mutual debts net out

- **WHEN** A owes B 50 and B owes A 30 and A or B records a cash payment of 20
- **THEN** the net debt becomes zero without changing the original expenses

#### Scenario: Stale amount

- **WHEN** another expense changed the net debt after the dialog showed it
- **THEN** the server answers `settlement_changed` and records nothing

### Requirement: Cash payments are attributed and idempotent

The system SHALL record who entered a cash payment in the audit feed. A repeated submission with the same idempotency key MUST NOT create a second payment.

#### Scenario: Double tap

- **WHEN** the same cash payment request arrives twice with one idempotency key
- **THEN** one payment exists and the second response repeats the first
