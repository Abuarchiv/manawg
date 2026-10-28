# public-dashboard-entry Specification

## Purpose
Let signed-out visitors explore the app and start registration or sign-in on their own, without exposing any private WG data.

## Requirements

### Requirement: Signed-out visitors can start registration or sign-in

The public entry SHALL offer both "Konto erstellen" and "Anmelden" to signed-out visitors, preserving a valid invitation code, without turning public exploration into a login wall.

#### Scenario: Invitation link while signed out

- **WHEN** a signed-out visitor opens `/?code=MTE8PZAT`
- **THEN** the page shows the invitation with a registration action and a sign-in action that both carry the code

### Requirement: Public app exploration
The app SHALL show its dashboard without login and SHALL provide working navigation to read-only empty states for its existing modules. Public exploration MUST NOT create accounts or WGs, query private WG data, use an anonymous Supabase identity, or activate test fixtures.

#### Scenario: Signed-out first visit
- **WHEN** a visitor opens the app root with no session
- **THEN** the dashboard and module navigation are visible without redirecting to authentication
- **AND** no private WG data or local legacy identity is displayed

#### Scenario: Explore a module
- **WHEN** the visitor follows a module link or reloads its public URL
- **THEN** the selected module's clearly read-only empty state is visible, with an action to create a WG before saving anything

### Requirement: Contextual welcome block
The dashboard SHALL place one contextual block below its header and above statistics. Without a WG it SHALL offer "WG erstellen" as the primary action and "Anmelden" as a secondary action. An invitation SHALL replace the create action with "Dieser WG beitreten". A member dashboard SHALL show "Willkommen in deiner WG" and the actual WG name without a primary create action.

#### Scenario: Authenticated account without a WG
- **WHEN** server membership lookup confirms an authenticated account has no active WG
- **THEN** the create block remains visible and creation continues without requesting authentication again

#### Scenario: Existing member returns
- **WHEN** a verified account has an active WG membership
- **THEN** the app opens that WG or offers the account's server-loaded WGs to choose from
- **AND** the member dashboard shows the welcome block

#### Scenario: Membership lookup fails
- **WHEN** the account's memberships cannot be loaded
- **THEN** the app offers a retry and does not represent the failure as a confirmed empty membership list
- **AND** public exploration remains available

### Requirement: Authentication follows an explicit action
Creation and joining SHALL require a verified Supabase account and explicit completion of their forms. Login alone MUST NOT create a WG or a membership. Create and invitation intent SHALL survive authentication and safe local redirects.

#### Scenario: Create intent
- **WHEN** a signed-out visitor selects "WG erstellen"
- **THEN** authentication starts with the create destination preserved
- **AND** cancelling authentication leaves the public app accessible

#### Scenario: Invitation intent
- **WHEN** a visitor opens a supported invitation link and chooses to join
- **THEN** authentication preserves the invitation and continues to the existing WG, never to creation of another WG

### Requirement: Private data remains protected
Private WG routes and APIs MUST remain authenticated and membership-authorized. The service worker MUST NOT cache private WG HTML or account-dependent responses for a subsequent visitor. Existing business data and calendar feed signing MUST remain unchanged.

#### Scenario: Browser switches accounts
- **WHEN** a user signs out and the app is revisited, including offline
- **THEN** a previously cached private WG page is not served as public content

### Requirement: Real release verification
Release claims SHALL use real-browser tests against an explicitly authorized hosted deployment backed by Supabase. Local PostgreSQL, mock authentication, or fixture success MUST NOT be presented as release proof.

#### Scenario: Deployment not yet authorized
- **WHEN** only source checks and a baseline live regression are available
- **THEN** the result is reported as implemented but not live-verified or released
