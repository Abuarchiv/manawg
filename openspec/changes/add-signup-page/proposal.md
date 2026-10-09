## Why

A visitor who wants a new account finds no registration page. `/neu` is the only authentication surface; it is a sign-in form whose secondary "Konto erstellen" button submits the very same fields. There is no registration heading, no password confirmation, no consent wording for new accounts, and no recovery path when the confirmation mail does not arrive or the visitor signs in before confirming. This reads as unprofessional and confuses new users.

## What Changes

- Add a public registration page at `/registrieren` with Google, e-mail/password (password confirmation, consent wording), and phone/SMS when enabled.
- Preserve the validated create/join intent (`action=create`, `code`, `next`) across `/neu` and `/registrieren` in both directions.
- Remove the combined "Konto erstellen" button from the sign-in form; link to `/registrieren` instead ("Noch kein Konto?"), and link back ("Schon ein Konto?").
- Show a dedicated "check your inbox" state after e-mail registration with a throttled resend action and a link back to sign-in.
- Offer "Bestätigungs-Mail erneut senden" when sign-in fails because the address is not yet confirmed.
- Public entry offers "Konto erstellen" next to "Anmelden" for signed-out visitors.
- Signed-in visitors opening `/registrieren` are redirected to the start flow instead of seeing a form.
- Soften the callback failure copy: a confirmation link opened in another browser still confirmed the address.

## Capabilities

### Modified Capabilities

- `supabase-credential-auth`: A dedicated registration surface, confirmation resend, and intent preservation across sign-in and registration.
- `public-dashboard-entry`: Signed-out visitors see both account actions.

## Impact

`src/app/registrieren/`, `src/components/auth/*`, `src/core/auth/client.ts` and a new intent helper, `PublicApp`/`WgWelcome`, e2e specs. No database schema, new dependency, or Supabase dashboard change. Hosted Supabase gates (redirect allowlist for `/auth/callback`, SMTP) are unchanged because the callback route is reused.
