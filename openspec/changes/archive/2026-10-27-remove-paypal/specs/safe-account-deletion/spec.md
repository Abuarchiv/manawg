## MODIFIED Requirements

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
