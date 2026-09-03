## Why

The app currently redirects every visitor into authentication. The approved product flow lets visitors explore the app first and asks them to authenticate only when creating or joining a WG. The existing welcome block must become the contextual entry action.

## What Changes

- Replace the root authentication redirect with a public, read-only dashboard and browsable module empty states.
- Show a single contextual welcome block above dashboard statistics: create WG without membership, join WG with an invitation, welcome with membership.
- Preserve create/join intent through existing Supabase authentication; authentication alone never creates a WG.
- Load returning users' memberships from the server and keep private WG routes protected.
- Keep navigation, typography, theme, and mobile frame consistent with the existing app.

## Capabilities

### New Capabilities
- `public-dashboard-entry`: Public exploration, contextual create/join/welcome action, and action-gated authentication.

### Modified Capabilities

None.

## Impact

App entry, public module navigation, WG dashboard welcome block, onboarding intent, service-worker cache policy, and Playwright E2E. No database schema/data change, provider activation, production deployment, or dependency addition is required for this entry slice. Google/email/phone expansion and the complete legacy-identity migration remain separate work from this approved dashboard change; this change must not claim they are complete.
