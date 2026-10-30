# safe-account-deletion Specification

## Purpose
Allow a signed-in user to delete their account without retaining access to shared WGs, destroying another member's concurrently joined WG, or leaving new memberships attached to a deleted identity. Preserve the financial history of remaining members and complete accepted deletion requests after process or Auth-provider failures.

## Requirements

### Requirement: Deletion is authorized by the signed-in account

The system SHALL delete only the account identified by server-verified authentication. The account-deletion endpoint SHALL retain same-origin mutation protection and rate limiting, and SHALL reject requests without a verified identity or without the required server-side Auth administration configuration before changing application data.

#### Scenario: Another account identifier is supplied
- **WHEN** a caller supplies a different account identifier in a request body, query, or header
- **THEN** the system SHALL NOT delete that account or use that identifier as deletion authority

#### Scenario: Deletion is unavailable
- **WHEN** required Auth administration configuration is absent
- **THEN** the system SHALL return an unavailable response without detaching memberships or deleting WG data

### Requirement: Accepted deletion permanently fences membership acquisition

After local deletion has committed, the system SHALL reject creating or joining a WG for that account. The rejection SHALL apply to requests authenticated before deletion as well as requests received while Auth deletion is pending. Application-data cleanup and the durable deletion fence SHALL commit together or both roll back.

#### Scenario: Membership acquisition finishes first
- **WHEN** a membership acquisition commits before the account's deletion fence
- **THEN** account deletion SHALL include that membership in its cleanup

#### Scenario: A previously authenticated request resumes after cleanup
- **WHEN** an already authenticated create or join request attempts its write after local deletion commits
- **THEN** it SHALL be rejected without creating or linking a membership, including when it targets a previously unrelated WG

#### Scenario: Local cleanup fails
- **WHEN** the local deletion transaction fails before a confirmed commit
- **THEN** the system SHALL NOT call Auth deletion based on that failed transaction, and SHALL NOT report accepted deletion without a committed fence

### Requirement: WG deletion and admin transfer preserve concurrent members

Account deletion SHALL decide whether a WG has remaining active members using membership state serialized with joins, legacy claims, other account deletions, member activation changes, and direct WG deletion. A WG with another active member who has an account SHALL retain its data. A remaining active member SHALL receive the admin role when the departing account was admin, choosing the longest-standing active member with an account. If no other active member with an account remains, the WG SHALL be deleted as disclosed by the confirmation.

#### Scenario: A join completes while account deletion is starting
- **WHEN** a new member's join commits before the deletion decision for that WG
- **THEN** the WG and that membership SHALL survive the departing account's deletion

#### Scenario: Solo-WG deletion finishes first
- **WHEN** deletion removes the WG before a concurrent join can make its membership decision
- **THEN** the join SHALL fail without reporting a successfully retained membership

#### Scenario: Two accounts delete themselves from shared WGs
- **WHEN** two members concurrently delete accounts that share one or more WGs
- **THEN** the resulting retained WGs SHALL have a valid active admin, or be removed when no other active member with an account remains, without deleting a WG that still has another active member with an account

#### Scenario: The proposed successor moves out
- **WHEN** a candidate successor is concurrently deactivated or deletes their account
- **THEN** the final retained WG SHALL NOT have that inactive member as its only admin

#### Scenario: A former admin has an in-flight WG deletion request
- **WHEN** admin authority changes before an already authenticated WG-deletion request obtains its mutation authority
- **THEN** the request SHALL revalidate current authority and SHALL NOT delete the WG using the former role

### Requirement: Personal access credentials are revoked without erasing shared history

For retained WGs, deletion SHALL remove the account-to-member link, deactivate the member, remove their push subscriptions, and invalidate their calendar subscriptions. Existing shared financial entries, settlements, and balances SHALL remain unchanged. Cleanup SHALL be scoped to the departing account's memberships and credentials.

#### Scenario: A deleted account uses its old calendar URL
- **WHEN** the old calendar bearer URL is requested after local deletion commits
- **THEN** the feed SHALL be unavailable and SHALL NOT expose subsequent WG events

#### Scenario: A credential mutation was authorized before deletion
- **WHEN** an in-flight calendar creation or rotation, push subscription, or notification update resumes after the member was detached
- **THEN** it SHALL NOT restore calendar access, push subscriptions, or notification opt-in for that identity

#### Scenario: A subscription belongs to a different member
- **WHEN** one account is deleted from a shared WG
- **THEN** other members' subscriptions, active memberships, and financial history SHALL remain usable

### Requirement: Auth completion is durable and retryable

An accepted deletion SHALL remain recoverable without the original browser session. Auth-provider failure, process termination, and a lost provider-success response SHALL NOT discard the durable deletion fence or allow new membership acquisition. A scheduled retry SHALL distinguish confirmed absence of the Auth user from provider failure, and SHALL eventually revisit all pending records rather than permanently starving newer requests behind repeated failures.

#### Scenario: The process stops after local commit
- **WHEN** local deletion commits and the process exits before the Auth request
- **THEN** a subsequent retry SHALL complete Auth deletion using the durable record without repeating destructive WG cleanup

#### Scenario: Auth succeeds but completion recording fails
- **WHEN** Auth deletes the user but the response or subsequent completion update is lost
- **THEN** retry SHALL recognize the provider's explicit user-not-found result as completion, without treating arbitrary network or endpoint errors as success

#### Scenario: The provider is unavailable
- **WHEN** the Auth provider cannot confirm deletion
- **THEN** the request SHALL remain pending, membership acquisition SHALL remain blocked, and later retries SHALL remain possible

#### Scenario: Completed deletion is retried
- **WHEN** processing repeats for a completed deletion record
- **THEN** shared data, balances, admin assignments, and audit history SHALL NOT be changed a second time

### Requirement: Pending and completed deletion are represented truthfully

The API SHALL return HTTP 200 with confirmed completion only after Auth deletion or explicit provider-confirmed absence. If local cleanup is committed but Auth completion is pending, it SHALL return HTTP 202 with an explicit pending state. The UI SHALL preserve the existing explicit destructive confirmation, handle both accepted and completed deletion, and describe pending completion without implying that application data was left unchanged.

#### Scenario: Auth fails after accepted cleanup
- **WHEN** the browser receives a pending deletion response
- **THEN** it SHALL explain that deletion is being completed, clear local ManaWG data, attempt local sign-out, and leave the WG view without requesting the user to restore a deleted account to finish cleanup

#### Scenario: Browser storage or local sign-out fails
- **WHEN** server-side deletion was accepted but local cleanup fails
- **THEN** the UI SHALL NOT claim that the server-side deletion failed or repeat destructive cleanup solely because browser cleanup failed

### Requirement: Deletion bookkeeping is private and cannot weaken access control

Deletion bookkeeping SHALL be inaccessible to anonymous and authenticated Data API clients. It SHALL retain only the account identifier and necessary lifecycle timestamps, and SHALL NOT contain secrets, email addresses, names, or raw provider responses. Completion SHALL NOT remove the membership fence while stale authenticated requests could reuse the account identifier.

#### Scenario: A normal client queries deletion bookkeeping
- **WHEN** an anonymous or authenticated client attempts to read or mutate deletion records through the Data API
- **THEN** access SHALL be denied

#### Scenario: A stale request follows successful Auth deletion
- **WHEN** a request that previously obtained an authenticated identity resumes after completion
- **THEN** the retained fence SHALL still prevent creation or attachment of a membership for that identity
