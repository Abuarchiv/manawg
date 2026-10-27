# supabase-credential-auth Specification

## Purpose
TBD - created by archiving change add-signup-page. Update Purpose after archive.

## Requirements

### Requirement: Dedicated registration page

The system SHALL provide a public registration page at `/registrieren` that offers the same configured methods as sign-in (Google, e-mail/password, and phone/SMS when enabled) with registration wording. The e-mail form MUST require the new password twice and enforce the minimum length before any Supabase request. Signed-in visitors SHALL be redirected to the start flow instead of seeing the form.

#### Scenario: New visitor registers with e-mail

- **WHEN** a visitor submits a valid address and matching passwords of at least eight characters
- **THEN** the system requests Supabase sign-up and, if no session is returned, shows an account-neutral "check your inbox" state without presenting the visitor as signed in

#### Scenario: Mismatching or short password

- **WHEN** the passwords differ or are shorter than eight characters
- **THEN** the system shows a field-level error and sends no Supabase request

#### Scenario: Signed-in visitor opens the page

- **WHEN** a visitor with a valid session opens `/registrieren`
- **THEN** the system redirects to `/neu` with the validated intent

### Requirement: Intent survives moving between sign-in and registration

The system SHALL carry only a validated create/join intent (`action=create`, a valid share `code`, or a safe `next` path) between `/neu` and `/registrieren` and through e-mail confirmation. Unknown query parameters, absolute URLs, and `/neu` or `/registrieren` as `next` target MUST NOT be forwarded.

#### Scenario: Join intent from an invitation

- **WHEN** a visitor opens `/neu?code=MTE8PZAT` and follows "Konto erstellen"
- **THEN** the registration page opens with the same code and the confirmation link returns to `/neu?code=MTE8PZAT`

### Requirement: Missing confirmation mail has a recovery path

The system SHALL let a visitor resend the sign-up confirmation mail from the inbox state and, after a sign-in rejected for an unconfirmed address, from the sign-in form. Resend MUST be throttled in the client and MUST NOT reveal whether the address has an account.

#### Scenario: Resend is throttled

- **WHEN** a visitor requests a resend
- **THEN** the action is disabled for 60 seconds and a neutral confirmation is shown

#### Scenario: Unconfirmed address signs in

- **WHEN** Supabase rejects sign-in with `email_not_confirmed`
- **THEN** the system shows the existing unconfirmed message together with a resend action
