## Why
PayPal can finish onboarding without returning to the configured local callback. The member needs to complete the already consented connection from settings.

## What Changes
Add authenticated `POST paypal/connect` action `complete`, which discovers the recipient from the signed cookie tracking ID and uses existing readiness and payment-lock persistence. Expose “Verbindung prüfen” when disconnected or recovering a return.

## Capabilities
### Modified Capabilities
- `paypal-profile-free`: finish a pending provider-hosted connection without a callback merchant hint.

## Impact
Existing connect route, onboarding helper, settings control and focused regressions. No migration, dependency, public exposure, deployment or payment-state changes.
