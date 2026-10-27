# paypal-profile-free Specification

## Purpose
TBD - created by archiving change remove-paypal-profile-setup. Update Purpose after archive.

## Requirements

### Requirement: Profile without PayPal setup
The application SHALL display profile and appearance settings without a manually editable PayPal account field, and SHALL offer provider-hosted connection when configured.

#### Scenario: Member opens profile
- **WHEN** a member opens profile settings
- **THEN** no Merchant-ID or PayPal.me field is displayed
- **AND** no manually typed Merchant-ID update is available
- **AND** the member identity and theme controls remain usable

### Requirement: Preserve payment integrity
Removing profile configuration SHALL NOT delete existing payment records or change automatic capture and manual settlement safeguards.

#### Scenario: Existing payment is pending
- **WHEN** the profile setup is removed
- **THEN** existing payment endpoints and pending-payment protections remain available

### Requirement: Provider-verified account connection
The application SHALL remember only a provider-verified recipient account after explicit informed data-sharing consent. PayPal SHALL own login and account eligibility. Completion MUST bind to the same authenticated member, WG, environment and unexpired attempt.

#### Scenario: Completed connection
- **WHEN** PayPal confirms the matching tracking and account identity, receiving eligibility and payment permissions
- **THEN** the account is stored and displayed connected without typed PayPal data

#### Scenario: Incomplete or forged return
- **WHEN** return hints are forged, binding expires or provider eligibility is incomplete
- **THEN** no connection or settlement is recorded

### Requirement: Confirmed PayPal payment
The application SHALL retain manual settlement and SHALL record PayPal settlement only after backend-confirmed completed capture. It MUST verify recipient readiness before a new order.

#### Scenario: Approved but not captured
- **WHEN** the payer approves or cancels a PayPal window without confirmed capture
- **THEN** the debt remains open

#### Scenario: Completed capture
- **WHEN** the backend confirms the matching completed capture
- **THEN** the existing payment record updates balances without an additional manual settlement

### Requirement: Complete a begun connection without a callback
The application SHALL accept a verified same-origin member completion POST using only the current valid signed expiring connection cookie. It MUST validate identity, environment, configured-client tracking and unchanged prior recipient before provider lookup, then resolve exact tracking to a single valid merchant and apply canonical readiness and existing persistence locks. GET MUST remain read-only.

#### Scenario: Provider finishes without returning to ManaWG
- **WHEN** the member chooses “Verbindung prüfen” with a valid pending cookie and PayPal confirms the exact tracked recipient as ready
- **THEN** ManaWG stores the recipient through the existing payment/member locks and clears the cookie only after success

#### Scenario: Invalid, stale, incomplete or unsupported completion
- **WHEN** the cookie binding is invalid, previous recipient changed, lookup shape or tracking is unsupported, merchant is not ready, or an active payment blocks replacement
- **THEN** no recipient is written and the cookie is retained
- **AND** invalid local binding is rejected before any provider lookup

#### Scenario: Callback races completion
- **WHEN** completion and existing callback confirmation overlap
- **THEN** existing compare-and-set checks prevent overwrites and return success or a stable conflict
- **AND** callback URL nonce validation remains intact

### Requirement: Member can disconnect PayPal

A member SHALL be able to remove a stored PayPal recipient after confirmation. The disconnect SHALL run under the same payment lock as connect and capture, SHALL work without PayPal being configured, and SHALL be rejected with `409 paypal_payment_pending` while a payment is active. The same pending-payment message SHALL be used when account deletion, member deactivation or WG deletion is blocked by an active payment.

#### Scenario: Disconnect without active payment
- **WHEN** a member confirms "PayPal trennen" and no payment is active
- **THEN** the stored recipient SHALL be cleared and the profile SHALL show PayPal as not connected

#### Scenario: Disconnect during active payment
- **WHEN** a payment is pending
- **THEN** the system SHALL respond `409 paypal_payment_pending` and keep the recipient
