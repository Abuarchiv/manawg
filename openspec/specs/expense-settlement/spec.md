# expense-settlement Specification

## Purpose
Settle debts between members correctly by hand or with a recorded cash payment, and tell the counterparty.

## Requirements

### Requirement: Opposite debts offset as a pair

When a settlement scope includes both directions between two members, the system SHALL settle both directions together and the dialog SHALL show counter-claims with a minus sign.

#### Scenario: Mutual debts
- **WHEN** A owes B 20 EUR and B owes A 5 EUR and A settles
- **THEN** both directions SHALL be settled together and only the net amount SHALL be paid

### Requirement: Counterparty is notified of settlement

The system SHALL send the notification event `expense.debt_settled` to the counterparty after a manual batch settlement that settled at least one share, after a single-share settlement that completed, and after a recorded cash payment.

#### Scenario: Nothing settled
- **WHEN** a batch settlement settles no share
- **THEN** no notification SHALL be sent

### Requirement: Balances and reminders are unambiguous

Balance lists SHALL omit zero rows, showing one "ausgeglichen" entry per active member without balance and moved-out members only with a balance. Reminder messages SHALL always carry the debt currency.

#### Scenario: Moved-out member without balance
- **WHEN** a moved-out member has no open balance
- **THEN** the member SHALL NOT appear in the balance list
