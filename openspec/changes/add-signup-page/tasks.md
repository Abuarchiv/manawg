## 1. Intent and client

- [x] 1.1 Add `core/auth/auth-intent.ts` with validated intent query handling and unit tests.
- [x] 1.2 Add `resendSignupConfirmation` to the browser auth client.

## 2. Registration surface

- [x] 2.1 Add `/registrieren` (server redirect for signed-in visitors, client form, metadata).
- [x] 2.2 Add the e-mail sign-up form with password confirmation and the inbox/resend state.
- [x] 2.3 Give `CredentialsAuth`, Google button and consent copy a sign-up mode.

## 3. Sign-in and entry

- [x] 3.1 Replace the combined "Konto erstellen" button on `/neu` by cross-links and add the unconfirmed-address resend.
- [x] 3.2 Show "Konto erstellen" and "Anmelden" for signed-out visitors on the public entry.
- [x] 3.3 Correct the callback failure copy.

## 4. Verification

- [x] 4.1 Update and add e2e coverage (fixture lane) and unit tests.
- [x] 4.2 Run lint, typecheck, unit, build and the fixture e2e suite; report exact results.
- [ ] 4.3 Hosted check in Preview (real confirmation mail, redirect allowlist) before promotion.
