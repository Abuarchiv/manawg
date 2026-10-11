## Purpose

Provide recoverable Supabase account access without returning to browser-local identity or making public exploration require authentication.

## ADDED Requirements

### Requirement: Action-gated credential authentication

The system SHALL let a visitor who explicitly starts WG creation or invitation joining choose Google, email/password, or phone/SMS OTP. Public exploration SHALL remain available without a session, and authentication alone MUST NOT create a WG, create a membership, or disclose WG membership.

#### Scenario: Create intent survives sign-in

- **WHEN** a visitor starts WG creation and completes a supported Supabase sign-in
- **THEN** the system returns to the creation form and waits for the visitor to submit it

#### Scenario: Public visitor explores without an account

- **WHEN** a visitor opens the public entry without starting a create or join action
- **THEN** the system shows public content without requesting authentication or private WG data

### Requirement: Email and phone flows protect account privacy

The system SHALL use Supabase for email/password and phone/SMS authentication. It MUST NOT store passwords, OTPs, Supabase tokens, or account identifiers in URLs, drafts, analytics, or browser-local identity records. Visible failures for credentials MUST NOT reveal whether a particular account exists.

#### Scenario: Email confirmation is pending

- **WHEN** email registration requires confirmation and Supabase does not return a session
- **THEN** the system reports that verification is required and does not present the visitor as authenticated

### Requirement: Password recovery is explicit and session-gated

The system SHALL let a visitor request a Supabase password-reset email without revealing whether the email address has an account. A reset callback SHALL return only to the fixed reset route, and changing the password SHALL require the Supabase session established by that callback. Password recovery MUST NOT create a WG, create a membership, or expose credentials or tokens in URLs, drafts, analytics, or local identity records.

#### Scenario: Reset request is account-neutral

- **WHEN** a visitor submits a syntactically valid email address for password recovery
- **THEN** the system shows a neutral confirmation regardless of whether Supabase has a matching account

#### Scenario: Valid reset link updates the password

- **WHEN** Supabase establishes a session from a valid reset link and the visitor submits matching new-password values
- **THEN** the system updates only that account's password and returns to the safe start route without creating WG state

#### Scenario: Invalid reset link stays unauthenticated

- **WHEN** the reset callback cannot establish a Supabase session
- **THEN** the system shows a generic invalid-or-expired-link message and does not render a password-update action

#### Scenario: Invalid phone OTP

- **WHEN** a visitor submits an invalid or expired SMS code
- **THEN** the system keeps the visitor unauthenticated and shows a generic retry message

### Requirement: Provider availability is truthful

The system SHALL not present disabled Apple or Facebook providers as sign-in choices. If the Supabase phone provider is not available, the system MUST fail safely with an actionable generic availability message and remain unauthenticated.

#### Scenario: Disabled phone provider

- **WHEN** Supabase rejects a phone OTP request because phone authentication is disabled
- **THEN** the system shows that the method is currently unavailable without exposing Supabase configuration details
