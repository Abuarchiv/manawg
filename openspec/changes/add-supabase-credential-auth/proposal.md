## Why

ManaWG currently offers only social providers in its visible sign-in surface, although the production Supabase project has email enabled and the product requires an alternative to Google. The product must use one recoverable Supabase account model without restoring browser-local name or code login.

## What Changes

- Add Supabase email/password registration and sign-in alongside Google.
- Add the phone/SMS OTP flow, with safe unavailable states until the Supabase provider is configured.
- Add an explicit password-reset request and `/auth/reset` callback flow before broad password-only promotion.
- Keep public exploration unauthenticated and preserve a create or invitation intent through authentication.
- **BREAKING** Remove Apple and Facebook from the visible authentication options; neither provider is configured.

## Capabilities

### New Capabilities

- `supabase-credential-auth`: Recoverable email/password and phone/SMS authentication for action-gated ManaWG use.

### Modified Capabilities

- `public-dashboard-entry`: Authentication choices for create and join actions include the configured credential methods without turning public exploration into a login wall.

## Impact

The browser auth client, start screen, Supabase Auth provider settings, email/SMS delivery configuration, callback allowlist, deployed-browser verification, and the public-entry integration are affected. No database schema, custom identity store, or new dependency is required.
