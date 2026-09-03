## 1. Secure product boundary

- [ ] 1.1 Integrate the public-entry membership guard and service-worker public-document allowlist; verify that a signed-in non-member cannot receive WG HTML, roster, or offline cached private content.
- [ ] 1.2 Keep legacy recovery outside the private WG renderer and verify that recovery requires both a Supabase session and the existing proof; do not add name/code-only claiming.
- [ ] 1.3 Normalize invitation links and lookup responses so public entry, explicit join, auth failures, and infrastructure failures remain distinct; verify code rotation and join-disable races.

## 2. Credential implementation

- [ ] 2.1 Add accessible Google, email/password sign-up/sign-in, and phone/SMS OTP UI using the existing Supabase browser client; verify Node 22 typecheck and production build.
- [ ] 2.2 Preserve only validated create/join intent through every auth method and reload account state after a resulting session; verify no automatic WG or membership write occurs.
- [ ] 2.3 Remove disabled Apple/Facebook choices and add generic failure states that do not enumerate accounts; verify source checks and focused E2E coverage.
- [ ] 2.4 Add password recovery before broad password-only promotion; verify the confirmation and recovery callback reach the intended safe route without exposing credentials.

## 3. Hosted Supabase release gates

- [ ] 3.1 Under explicit configuration authority, verify Site URL/redirect allowlist, SMTP sender and delivery, phone provider, CAPTCHA, and rate limits in Preview and Production.
- [ ] 3.2 Run a real protected-preview browser matrix against Supabase: guest browse, Google, email sign-up/confirmation/sign-in, wrong credentials, SMS request/valid/invalid OTP, create, invite, logout/account switch, non-member and offline-cache denial.
- [ ] 3.3 Promote only after protected CI has its Preview secret configuration and all source, database, and hosted-browser gates are green.
