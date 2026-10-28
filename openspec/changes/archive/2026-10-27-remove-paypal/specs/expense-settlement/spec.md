## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Abandoned PayPal orders do not block the WG

**Reason**: PayPal settlement is removed; there are no provider orders.
**Migration**: Members settle by hand or record a cash payment.

### Requirement: PayPal errors are explained

**Reason**: PayPal settlement is removed; the payment UI has no provider errors.
**Migration**: None.
