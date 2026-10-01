## ADDED Requirements
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
